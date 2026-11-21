//! The server's own iroh node, behind the server's relay: the node a browser connects to. It uses
//! no address lookup and no relay but ours (see Transport under Phase 3 in docs/spec/network.md),
//! and it tells the app its id itself, at `/node`. Its key is kept in a file, so a restart keeps its
//! id and a connected node only waits for the server to come back.
//!
//! No protocol runs on it yet. It answers [`ECHO`], which sends back what it receives, so the
//! browser's side can be tested end to end.

use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::Router;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use iroh::endpoint::{BindError, Connection, presets};
use iroh::protocol::{AcceptError, ProtocolHandler, Router as Protocols};
use iroh::{Endpoint, EndpointId, RelayMap, RelayMode, RelayUrl, SecretKey};

use crate::header as security;

/// The echo protocol's name in the connection handshake (QUIC's ALPN).
pub(crate) const ECHO: &[u8] = b"week-budget-planner/echo/0";
/// The most bytes the echo reads before answering.
const ECHO_LIMIT: usize = 64 * 1024;
/// How long the node may take to reach the relay when the server starts.
const ONLINE_TIMEOUT: Duration = Duration::from_secs(10);

/// Why the node couldn't start.
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("couldn't bind the node: {0}")]
    Bind(#[from] BindError),
    #[error("the node didn't reach the relay within {ONLINE_TIMEOUT:?}")]
    Offline,
}

/// Why the node's key couldn't be read or kept.
#[derive(Debug, thiserror::Error)]
pub(crate) enum KeyError {
    #[error("couldn't read the node's key from {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{0} doesn't hold a node key: 64 hexadecimal digits")]
    Format(PathBuf),
    #[error("couldn't write the node's new key to {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

/// A key as the file holds it: its 32 bytes as 64 lowercase hexadecimal digits, and a line break.
fn format_key(key: &SecretKey) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(65);
    for byte in key.to_bytes() {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }

    text.push('\n');
    text
}

/// A key from the file's text, or none when it isn't 64 hexadecimal digits.
fn parse_key(text: &str) -> Option<SecretKey> {
    let digits = text.trim().as_bytes();
    if digits.len() != 64 {
        return None;
    }

    let mut bytes = [0; 32];
    let (pairs, _) = digits.as_chunks::<2>();
    for (byte, pair) in bytes.iter_mut().zip(pairs) {
        *byte = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
    }

    Some(SecretKey::from_bytes(&bytes))
}

/// Writes a new key to a file that doesn't exist yet, readable by the server's user only.
fn write_new_key(path: &Path, key: &SecretKey) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(format_key(key).as_bytes())?;
    file.sync_all()
}

/// The node's key from its file, or a new one, written to the file, on the first start.
///
/// # Errors
///
/// When the file can't be read or written, or doesn't hold a key.
pub(crate) fn load_or_create_key(path: &Path) -> Result<SecretKey, KeyError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let key = SecretKey::generate();
            write_new_key(path, &key).map_err(|source| KeyError::Write {
                path: path.to_path_buf(),
                source,
            })?;
            tracing::info!(path = %path.display(), "made a new key for the server's node");
            return Ok(key);
        }
        Err(source) => {
            return Err(KeyError::Read {
                path: path.to_path_buf(),
                source,
            });
        }
    };
    parse_key(&text).ok_or_else(|| KeyError::Format(path.to_path_buf()))
}

/// Sends back what a stream sends, once it has finished sending.
#[derive(Debug, Clone)]
struct Echo;

impl ProtocolHandler for Echo {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let (mut send, mut receive) = connection.accept_bi().await?;
        let received = receive
            .read_to_end(ECHO_LIMIT)
            .await
            .map_err(AcceptError::from_err)?;
        send.write_all(&received)
            .await
            .map_err(AcceptError::from_err)?;
        send.finish()?;
        connection.closed().await;
        Ok(())
    }
}

/// Starts the node and waits until it has reached the relay.
///
/// * `relay_url` - How the node reaches the relay: the server's own port, on this machine.
///
/// # Errors
///
/// When the node can't bind, or doesn't reach the relay within [`ONLINE_TIMEOUT`].
pub(crate) async fn spawn(secret_key: SecretKey, relay_url: RelayUrl) -> Result<Protocols, Error> {
    let endpoint = Endpoint::builder(presets::Minimal)
        .secret_key(secret_key)
        .relay_mode(RelayMode::Custom(RelayMap::from(relay_url)))
        .alpns(vec![ECHO.to_vec()])
        .bind()
        .await?;
    tokio::time::timeout(ONLINE_TIMEOUT, endpoint.online())
        .await
        .map_err(|_| Error::Offline)?;
    Ok(Protocols::builder(endpoint).accept(ECHO, Echo).spawn())
}

/// The node's id as the app reads it: `{"nodeId":"…"}`.
fn describe(id: EndpointId) -> String {
    // An id's text is lowercase hex, which JSON takes as it is.
    format!(r#"{{"nodeId":"{id}"}}"#)
}

/// The route where the app learns the server's node: `/node`.
pub(crate) fn route(id: EndpointId) -> Router {
    let body = describe(id);
    Router::new().route(
        "/node",
        get(move || {
            let body = body.clone();
            async move {
                let mut response: Response = body.into_response();
                let headers = response.headers_mut();
                security::add_common(headers);
                headers.insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/json"),
                );
                headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                response
            }
        }),
    )
}

#[cfg(test)]
mod test {
    use iroh::SecretKey;

    use super::{KeyError, describe, format_key, load_or_create_key, parse_key};

    #[test]
    fn writes_a_key_as_it_reads_it() {
        let key = SecretKey::generate();
        let text = format_key(&key);
        assert_eq!(text.len(), 65);
        assert_eq!(parse_key(&text).unwrap().public(), key.public());
    }

    #[test]
    fn refuses_text_that_isn_t_a_key() {
        assert!(parse_key("").is_none());
        assert!(parse_key(&"0".repeat(63)).is_none());
        assert!(parse_key(&"g".repeat(64)).is_none());
    }

    #[test]
    fn makes_the_key_once_and_keeps_it() {
        let path = std::env::temp_dir().join(format!(
            "week-budget-planner-node-key-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let first = load_or_create_key(&path).unwrap();
        let again = load_or_create_key(&path).unwrap();
        assert_eq!(first.public(), again.public());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        std::fs::write(&path, "not a key").unwrap();
        assert!(matches!(
            load_or_create_key(&path),
            Err(KeyError::Format(_))
        ));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn describes_the_node_as_json() {
        let id = SecretKey::from_bytes(&[7; 32]).public();
        let text = id.to_string();
        assert!(text.chars().all(|character| character.is_ascii_hexdigit()));
        assert_eq!(describe(id), format!(r#"{{"nodeId":"{text}"}}"#));
    }
}

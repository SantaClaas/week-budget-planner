//! The server's own iroh node, behind the server's relay: the node a browser connects to. It uses
//! no address lookup and no relay but ours (see Transport under Phase 3 in docs/spec/network.md),
//! and it tells the app its id itself, at `/node`.
//!
//! No protocol runs on it yet. It answers [`ECHO`], which sends back what it receives, so the
//! browser's side can be tested end to end.

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

    use super::describe;

    #[test]
    fn describes_the_node_as_json() {
        let id = SecretKey::from_bytes(&[7; 32]).public();
        let text = id.to_string();
        assert!(text.chars().all(|character| character.is_ascii_hexdigit()));
        assert_eq!(describe(id), format!(r#"{{"nodeId":"{text}"}}"#));
    }
}

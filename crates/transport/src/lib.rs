//! The browser's side of the transport: an iroh node, built from the `iroh` crate into a
//! WebAssembly module of our own (see crates/transport/README.md and Transport under Phase 3 in
//! docs/spec/network.md).
//!
//! It says nothing about syncing. It makes a node from a key, connects to another node by its id
//! through the one relay it knows, and sends and receives bytes on streams. Every call that waits
//! on the network takes a deadline, and every failure comes back as a [`Failure`].

mod connection;
mod failure;

use iroh::endpoint::presets;
use iroh::{
    Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, SecretKey, TransportAddr,
};
use n0_future::time::Duration;
use wasm_bindgen::prelude::wasm_bindgen;

pub use crate::connection::{Connection, Stream};
use crate::failure::run_within;
pub use crate::failure::{Failure, Type};

// Only so getrandom takes its random numbers from the browser (see getrandom in Cargo.toml).
#[cfg(target_family = "wasm")]
use getrandom as _;

/// How long a secret key is, in bytes.
const SECRET_KEY_LENGTH: usize = 32;

fn parse_secret_key(bytes: &[u8]) -> Result<SecretKey, Failure> {
    let Ok(bytes) = <&[u8; SECRET_KEY_LENGTH]>::try_from(bytes) else {
        return Err(Failure::new(
            Type::Invalid,
            format!(
                "a secret key is {SECRET_KEY_LENGTH} bytes, not {}",
                bytes.len()
            ),
        ));
    };

    Ok(SecretKey::from_bytes(bytes))
}

fn parse_relay_url(text: &str) -> Result<RelayUrl, Failure> {
    text.parse()
        .map_err(|error| Failure::new(Type::Invalid, format!("{text} isn't a relay URL: {error}")))
}

fn parse_node_id(text: &str) -> Result<EndpointId, Failure> {
    text.parse()
        .map_err(|error| Failure::new(Type::Invalid, format!("{text} isn't a node id: {error}")))
}

/// An iroh node that reaches other nodes only through one relay, with no address lookup.
#[wasm_bindgen]
pub struct Node {
    endpoint: Endpoint,
    relay_url: RelayUrl,
}

#[wasm_bindgen]
impl Node {
    /// Starts a node and waits until it has reached the relay.
    ///
    /// * `secret_key` - The node's 32 secret bytes, which make its id.
    /// * `relay_url` - The relay's origin, such as `https://example.com`: the node connects to its
    ///   `/relay` and measures it at `/ping`.
    /// * `timeout` - The deadline for reaching the relay, in milliseconds.
    ///
    /// # Errors
    ///
    /// [`Type::Invalid`] for a key or URL that isn't one, [`Type::Unreachable`] when the node
    /// can't start, or [`Type::Timeout`] when the relay doesn't answer in time.
    pub async fn spawn(
        secret_key: Vec<u8>,
        relay_url: String,
        timeout: u32,
    ) -> Result<Node, Failure> {
        let secret_key = parse_secret_key(&secret_key)?;
        let relay_url = parse_relay_url(&relay_url)?;
        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(secret_key)
            .relay_mode(RelayMode::Custom(RelayMap::from(relay_url.clone())))
            .bind()
            .await
            .map_err(|error| Failure::new(Type::Unreachable, error))?;
        let online = async {
            endpoint.online().await;
            Ok::<(), std::convert::Infallible>(())
        };
        if let Err(failure) = run_within(
            Duration::from_millis(timeout.into()),
            Type::Unreachable,
            online,
        )
        .await
        {
            // Or it keeps trying to reach the relay in the background.
            endpoint.close().await;
            return Err(failure);
        }

        Ok(Node {
            endpoint,
            relay_url,
        })
    }

    /// The node's id, which other nodes connect to it by.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn id(&self) -> String {
        self.endpoint.id().to_string()
    }

    /// Connects to another node through the relay, for one protocol.
    ///
    /// * `node_id` - The other node's id.
    /// * `protocol` - The protocol's name, which the other node has to accept.
    /// * `timeout` - The deadline in milliseconds.
    ///
    /// # Errors
    ///
    /// [`Type::Invalid`] for an id that isn't one, [`Type::Unreachable`] when the other node
    /// refuses or the relay can't reach it, or [`Type::Timeout`].
    pub async fn connect(
        &self,
        node_id: String,
        protocol: String,
        timeout: u32,
    ) -> Result<Connection, Failure> {
        let id = parse_node_id(&node_id)?;
        let address = EndpointAddr::from_parts(id, [TransportAddr::Relay(self.relay_url.clone())]);
        let connection = run_within(
            Duration::from_millis(timeout.into()),
            Type::Unreachable,
            self.endpoint.connect(address, protocol.as_bytes()),
        )
        .await?;
        Ok(Connection::new(connection))
    }

    /// Closes every connection and stops the node.
    pub async fn close(&self) {
        self.endpoint.close().await;
    }
}

#[cfg(test)]
mod test {
    use super::{Type, parse_node_id, parse_relay_url, parse_secret_key};

    #[test]
    fn takes_a_key_of_32_bytes_only() {
        let key = parse_secret_key(&[7; 32]).unwrap();
        assert_eq!(key.to_bytes(), [7; 32]);
        assert_eq!(
            parse_secret_key(&[7; 31]).unwrap_err().r#type(),
            Type::Invalid
        );
        assert_eq!(parse_secret_key(&[]).unwrap_err().r#type(), Type::Invalid);
    }

    #[test]
    fn refuses_what_isn_t_a_relay_url_or_a_node_id() {
        assert!(parse_relay_url("http://localhost:8080").is_ok());
        assert_eq!(
            parse_relay_url("not a url").unwrap_err().r#type(),
            Type::Invalid
        );
        assert_eq!(
            parse_node_id("not an id").unwrap_err().r#type(),
            Type::Invalid
        );
        let id = iroh::SecretKey::from_bytes(&[7; 32]).public();
        assert_eq!(parse_node_id(&id.to_string()).unwrap(), id);
    }
}

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
use crate::failure::RunWithin;
pub use crate::failure::{Failure, Type};

// Only so getrandom takes its random numbers from the browser (see getrandom in Cargo.toml).
#[cfg(target_family = "wasm")]
use getrandom as _;

/// How long a secret key is, in bytes.
const SECRET_KEY_LENGTH: usize = 32;

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
    pub async fn spawn(secret_key: &[u8], relay_url: &str, timeout: u32) -> Result<Node, Failure> {
        let secret_key = <&[u8; SECRET_KEY_LENGTH]>::try_from(secret_key)
            .map(SecretKey::from_bytes)
            .map_err(|_| {
                let length = secret_key.len();
                Failure::new(
                    Type::Invalid,
                    format!("a secret key is {SECRET_KEY_LENGTH} bytes, not {length}"),
                )
            })?;
        let relay_url: RelayUrl = relay_url.parse().map_err(|error| {
            Failure::new(
                Type::Invalid,
                format!("{relay_url} isn't a relay URL: {error}"),
            )
        })?;
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
        if let Err(failure) = online
            .run_within(Duration::from_millis(timeout.into()), Type::Unreachable)
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
        node_id: &str,
        protocol: &str,
        timeout: u32,
    ) -> Result<Connection, Failure> {
        let id: EndpointId = node_id.parse().map_err(|error| {
            Failure::new(Type::Invalid, format!("{node_id} isn't a node id: {error}"))
        })?;
        let address = EndpointAddr::from_parts(id, [TransportAddr::Relay(self.relay_url.clone())]);
        let connection = self
            .endpoint
            .connect(address, protocol.as_bytes())
            .run_within(Duration::from_millis(timeout.into()), Type::Unreachable)
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
    use super::{Node, Type};

    /// A relay URL that parses; these tests never reach it.
    const RELAY_URL: &str = "http://127.0.0.1:9";

    // Node isn't Debug, so a failure is read with err() rather than unwrap_err().

    #[tokio::test]
    async fn takes_a_key_of_32_bytes_only() {
        for key in [&[7; 31][..], &[7; 33], &[]] {
            let failure = Node::spawn(key, RELAY_URL, 1000).await.err().unwrap();
            assert_eq!(failure.r#type(), Type::Invalid, "{} bytes", key.len());
        }
    }

    #[tokio::test]
    async fn refuses_what_isn_t_a_relay_url() {
        let failure = Node::spawn(&[7; 32], "not a url", 1000)
            .await
            .err()
            .unwrap();
        assert_eq!(failure.r#type(), Type::Invalid);
    }
}

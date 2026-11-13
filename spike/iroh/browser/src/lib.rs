//! The browser side of the iroh spike (issue #80): one iroh endpoint in a
//! WebAssembly module of our own, built from the `iroh` crate directly.
//!
//! It binds an endpoint that only knows one relay (ours), can dial another
//! endpoint by its public key through that relay and echo bytes, and accepts
//! the same echo protocol, so two browser nodes can reach each other.

use iroh::{
    Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, TransportAddr,
    endpoint::{Connection, presets},
    protocol::{AcceptError, ProtocolHandler, Router},
};
use wasm_bindgen::prelude::*;

const ALPN: &[u8] = b"week-budget-planner/spike-echo/0";

fn to_js(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

#[derive(Debug, Clone)]
struct Echo;

impl ProtocolHandler for Echo {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let (mut send, mut receive) = connection.accept_bi().await?;
        let received = receive
            .read_to_end(1 << 20)
            .await
            .map_err(AcceptError::from_err)?;
        let mut answer = b"browser echo: ".to_vec();
        answer.extend_from_slice(&received);
        send.write_all(&answer)
            .await
            .map_err(AcceptError::from_err)?;
        send.finish()?;
        connection.closed().await;
        Ok(())
    }
}

#[wasm_bindgen]
pub struct Node {
    router: Router,
    relay_url: RelayUrl,
}

#[wasm_bindgen]
impl Node {
    /// Binds an endpoint whose only relay is `relay_url`, with no address
    /// lookup at all (no pkarr, no DNS), and waits until it is connected to
    /// that relay.
    pub async fn spawn(relay_url: String) -> Result<Node, JsError> {
        console_error_panic_hook::set_once();
        let relay_url: RelayUrl = relay_url.parse().map_err(to_js)?;
        let endpoint = Endpoint::builder(presets::Minimal)
            .relay_mode(RelayMode::Custom(RelayMap::from(relay_url.clone())))
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .map_err(to_js)?;
        endpoint.online().await;
        let router = Router::builder(endpoint).accept(ALPN, Echo).spawn();
        Ok(Node { router, relay_url })
    }

    /// Binds an endpoint with iroh's defaults (the `N0` preset): n0's public
    /// relays and pkarr address lookup through dns.iroh.link.
    ///
    /// With `without_trailing_dot`, the relays are the same four n0 hosts,
    /// but written without the trailing dot iroh's defaults use
    /// ("use1-1.relay.n0.iroh.link." in `iroh::defaults::prod`).
    #[wasm_bindgen(js_name = spawnPublic)]
    pub async fn spawn_public(without_trailing_dot: bool) -> Result<Node, JsError> {
        console_error_panic_hook::set_once();
        let mut builder = Endpoint::builder(presets::N0);
        if without_trailing_dot {
            let relays = [
                "https://use1-1.relay.n0.iroh.link",
                "https://usw1-1.relay.n0.iroh.link",
                "https://euc1-1.relay.n0.iroh.link",
                "https://aps1-1.relay.n0.iroh.link",
            ];
            let map = RelayMap::try_from_iter(relays).map_err(to_js)?;
            builder = builder.relay_mode(RelayMode::Custom(map));
        }
        let endpoint = builder
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .map_err(to_js)?;
        endpoint.online().await;
        let relay_url = endpoint
            .addr()
            .relay_urls()
            .next()
            .cloned()
            .ok_or_else(|| JsError::new("no home relay"))?;
        let router = Router::builder(endpoint).accept(ALPN, Echo).spawn();
        Ok(Node { router, relay_url })
    }

    #[wasm_bindgen(js_name = relayUrl)]
    pub fn relay_url(&self) -> String {
        self.relay_url.to_string()
    }

    /// Dials `endpoint_id` by its public key alone: the address (its home
    /// relay) comes from address lookup.
    #[wasm_bindgen(js_name = echoById)]
    pub async fn echo_by_id(&self, endpoint_id: String, payload: Vec<u8>) -> Result<Vec<u8>, JsError> {
        let id: EndpointId = endpoint_id.parse().map_err(to_js)?;
        self.echo_to(EndpointAddr::from_parts(id, []), payload).await
    }

    #[wasm_bindgen(js_name = endpointId)]
    pub fn endpoint_id(&self) -> String {
        self.router.endpoint().id().to_string()
    }

    /// Dials `endpoint_id` through our relay, sends `payload` and returns
    /// what the other side sent back.
    pub async fn echo(&self, endpoint_id: String, payload: Vec<u8>) -> Result<Vec<u8>, JsError> {
        let id: EndpointId = endpoint_id.parse().map_err(to_js)?;
        let address = EndpointAddr::from_parts(id, [TransportAddr::Relay(self.relay_url.clone())]);
        self.echo_to(address, payload).await
    }

    pub async fn close(&self) {
        let _ = self.router.shutdown().await;
    }
}

impl Node {
    async fn echo_to(&self, address: EndpointAddr, payload: Vec<u8>) -> Result<Vec<u8>, JsError> {
        let connection = self
            .router
            .endpoint()
            .connect(address, ALPN)
            .await
            .map_err(to_js)?;
        let (mut send, mut receive) = connection.open_bi().await.map_err(to_js)?;
        send.write_all(&payload).await.map_err(to_js)?;
        send.finish().map_err(to_js)?;
        let answer = receive.read_to_end(1 << 20).await.map_err(to_js)?;
        connection.close(0u32.into(), b"done");
        Ok(answer)
    }
}

//! The native side of the iroh spike (issue #80): stands in for the sync
//! server. It runs an iroh relay of our own on plain HTTP on localhost (no
//! public relay, no DNS discovery) and a native iroh endpoint that uses only
//! that relay and answers the echo protocol.
//!
//! Prints one JSON line `{"endpointId":…,"relayUrl":…}` once it is ready.

use std::net::{Ipv4Addr, SocketAddr};

use iroh::{
    Endpoint, RelayMap, RelayMode, RelayUrl,
    endpoint::{Connection, presets},
    protocol::{AcceptError, ProtocolHandler, Router},
};
use iroh_relay::server::{RelayConfig, Server, ServerConfig};

const ALPN: &[u8] = b"week-budget-planner/spike-echo/0";

#[derive(Debug, Clone)]
struct Echo;

impl ProtocolHandler for Echo {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let remote = connection.remote_id();
        let (mut send, mut receive) = connection.accept_bi().await?;
        let received = receive
            .read_to_end(1 << 20)
            .await
            .map_err(AcceptError::from_err)?;
        eprintln!(
            "server: {remote} sent {} bytes: {:?}",
            received.len(),
            String::from_utf8_lossy(&received)
        );
        let mut answer = b"server echo: ".to_vec();
        answer.extend_from_slice(&received);
        send.write_all(&answer)
            .await
            .map_err(AcceptError::from_err)?;
        send.finish()?;
        connection.closed().await;
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    // PUBLIC=1: no relay of our own; use iroh's defaults (n0's public relays
    // and pkarr address lookup), through the container's HTTPS proxy.
    let is_public = std::env::var("PUBLIC").is_ok_and(|value| value == "1");
    let mut relay = None;
    let endpoint = if is_public {
        // The same four n0 relays as iroh's defaults, without the trailing dot
        // in their host names, which this container's proxy resets.
        let relays = [
            "https://use1-1.relay.n0.iroh.link",
            "https://usw1-1.relay.n0.iroh.link",
            "https://euc1-1.relay.n0.iroh.link",
            "https://aps1-1.relay.n0.iroh.link",
        ];
        Endpoint::builder(presets::N0)
            .relay_mode(RelayMode::Custom(RelayMap::try_from_iter(relays)?))
            .proxy_from_env()
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await?
    } else {
        let port: u16 = std::env::var("RELAY_PORT")
            .ok()
            .and_then(|port| port.parse().ok())
            .unwrap_or(3340);
        // `ServerConfig` is non-exhaustive: start from the default (no relay,
        // no QUIC address discovery) and turn on only the HTTP relay.
        let mut config = ServerConfig::default();
        config.relay = Some(RelayConfig::new(SocketAddr::from((
            Ipv4Addr::LOCALHOST,
            port,
        ))));
        let server = Server::spawn(config).await?;
        let address = server.http_addr().ok_or("relay has no HTTP address")?;
        let relay_url: RelayUrl = format!("http://localhost:{}", address.port()).parse()?;
        relay = Some(server);
        Endpoint::builder(presets::Minimal)
            .relay_mode(RelayMode::Custom(RelayMap::from(relay_url)))
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await?
    };
    endpoint.online().await;
    let relay_url = endpoint
        .addr()
        .relay_urls()
        .next()
        .cloned()
        .ok_or("no home relay")?;
    let router = Router::builder(endpoint).accept(ALPN, Echo).spawn();

    println!(
        "{{\"endpointId\":\"{}\",\"relayUrl\":\"{}\"}}",
        router.endpoint().id(),
        relay_url
    );

    tokio::signal::ctrl_c().await?;
    router.shutdown().await?;
    if let Some(relay) = relay {
        relay.shutdown().await?;
    }
    Ok(())
}

//! The Week Budget Planner's server. It serves the app's build, compressed at build time, with the
//! headers the app needs, and runs the iroh relay and the server's own node that syncing will
//! connect through (see crates/server/README.md and docs/spec/network.md).

mod base;
mod configuration;
mod credential;
mod header;
mod node;
mod relay;
mod site;

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::process::ExitCode;

use iroh::RelayUrl;
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

/// Why the server couldn't start or stopped.
#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("the configuration: {0}")]
    Configuration(#[from] configuration::Error),
    #[error("couldn't listen on {address}: {source}")]
    Listen {
        address: std::net::SocketAddr,
        source: std::io::Error,
    },
    #[error("the relay's address on this machine, {0}, isn't a relay URL: {1}")]
    RelayUrl(String, String),
    #[error("the server's secrets: {0}")]
    Credential(#[from] credential::Error),
    #[error("use: week-budget-planner-server [generate-node-key <file>]")]
    Usage,
    #[error("the server's node: {0}")]
    Node(#[from] node::Error),
    #[error("serving stopped: {0}")]
    Serve(#[from] std::io::Error),
    #[error("the serving task stopped: {0}")]
    Task(#[from] tokio::task::JoinError),
}

/// The address the server's own node reaches the relay at: the server's port on this machine,
/// through the loopback address when the server listens on every address.
fn find_local_address(listening: SocketAddr) -> SocketAddr {
    let ip = match listening.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        ip => ip,
    };
    SocketAddr::new(ip, listening.port())
}

/// Waits for Ctrl+C, or for the terminate signal a service manager or container runtime sends, so
/// the server stops taking connections and finishes the requests it has.
async fn wait_for_shutdown() {
    let interrupt = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::warn!(%error, "can't listen for Ctrl+C");
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::warn!(%error, "can't listen for the terminate signal");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }
    tracing::info!("shutting down");
}

async fn run() -> Result<(), Error> {
    let configuration = configuration::read(|name| std::env::var(name))?;
    // From the platform's secrets, not the configuration, so a restart keeps the node's id.
    let credentials = credential::find_directory(|name| std::env::var(name))?;
    let secret_key = credential::read_node_key(&credentials)?;
    let node_id = secret_key.public();
    // The member list will change who the relay admits (the mailbox, #97); until then it's everyone.
    let (relay, _admission) = relay::create();
    let router = site::route(&configuration.app, configuration.base)
        .merge(relay::route(relay.clone()))
        .merge(node::route(node_id))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        );
    let listen_error = |source| Error::Listen {
        address: configuration.address,
        source,
    };
    let listener = tokio::net::TcpListener::bind(configuration.address)
        .await
        .map_err(listen_error)?;
    let local_address = find_local_address(listener.local_addr().map_err(listen_error)?);
    let relay_url = format!("http://{local_address}");
    let relay_url: RelayUrl =
        relay_url
            .parse()
            .map_err(|error: <RelayUrl as std::str::FromStr>::Err| {
                Error::RelayUrl(relay_url.clone(), error.to_string())
            })?;
    tracing::info!(address = %configuration.address, app = %configuration.app.display(), "listening");
    // Serving starts first: the node reaches the relay through it.
    let serving = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(wait_for_shutdown())
            .await
    });
    let node = node::spawn(secret_key, relay_url).await?;
    tracing::info!(node = %node_id, "the node reached the relay");
    serving.await??;
    relay.shutdown().await;
    if let Err(error) = node.shutdown().await {
        tracing::warn!(%error, "the node didn't shut down cleanly");
    }

    Ok(())
}

/// Makes the node key for a new server, once (see Running it in crates/server/README.md).
fn generate_node_key(path: &std::path::Path) -> Result<(), Error> {
    let key = credential::generate_node_key(path)?;
    tracing::info!(path = %path.display(), node = %key.public(), "made a new node key");
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .json()
        .with_max_level(Level::INFO)
        .init();
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let outcome = match arguments.as_slice() {
        [] => run().await,
        [command, path] if command == "generate-node-key" => {
            generate_node_key(std::path::Path::new(path))
        }
        _ => Err(Error::Usage),
    };
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "the server stopped");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod test {
    use super::find_local_address;

    #[test]
    fn reaches_the_relay_on_this_machine() {
        let local = |address: &str| find_local_address(address.parse().unwrap()).to_string();
        assert_eq!(local("0.0.0.0:8080"), "127.0.0.1:8080");
        assert_eq!(local("[::]:8080"), "[::1]:8080");
        assert_eq!(local("127.0.0.1:4313"), "127.0.0.1:4313");
        assert_eq!(local("192.0.2.7:80"), "192.0.2.7:80");
    }
}

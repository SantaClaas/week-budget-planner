//! The Week Budget Planner's server. Today it serves the app's build, compressed at build time, with
//! the headers the app needs, and does nothing else (see crates/server/README.md and
//! docs/spec/network.md).

mod base;
mod config;
mod header;
mod site;

use std::process::ExitCode;

use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
use tracing::Level;

/// Why the server couldn't start or stopped.
#[derive(Debug, thiserror::Error)]
enum Error {
    #[error("the configuration: {0}")]
    Config(#[from] config::Error),
    #[error("couldn't read the app's page, {path}; run pnpm build first: {source}")]
    NoPage {
        path: std::path::PathBuf,
        source: std::io::Error,
    },
    #[error("the app's page: {0}")]
    Header(#[from] header::Error),
    #[error("couldn't listen on {address}: {source}")]
    Listen {
        address: std::net::SocketAddr,
        source: std::io::Error,
    },
    #[error("serving stopped: {0}")]
    Serve(std::io::Error),
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
    let config = config::read(|name| std::env::var(name).ok())?;
    let page_path = config.app.join("index.html");
    let page = std::fs::read_to_string(&page_path).map_err(|source| Error::NoPage {
        path: page_path,
        source,
    })?;
    let policy = header::read_policy(&page)?;
    let router = site::route(&config.app, config.base, policy).layer(
        TraceLayer::new_for_http()
            .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
            .on_response(DefaultOnResponse::new().level(Level::INFO)),
    );
    let listener = tokio::net::TcpListener::bind(config.address)
        .await
        .map_err(|source| Error::Listen {
            address: config.address,
            source,
        })?;
    tracing::info!(address = %config.address, app = %config.app.display(), "listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(wait_for_shutdown())
        .await
        .map_err(Error::Serve)
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .json()
        .with_max_level(Level::INFO)
        .init();
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "the server stopped");
            ExitCode::FAILURE
        }
    }
}

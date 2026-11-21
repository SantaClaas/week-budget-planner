//! The iroh relay, in the server's own process and on the app's origin, so the Content Security
//! Policy needs no new entry (see Transport under Phase 3 in docs/spec/network.md). A browser node
//! reaches it with a `fetch` to `/ping` and a WebSocket to `/relay`.
//!
//! `/relay` is an ordinary axum route. axum upgrades the request to a WebSocket, over HTTP/1.1 or
//! HTTP/2, and the connection then goes through iroh-relay's own handshake, access control and
//! client registry, the same steps its built-in server takes after an upgrade. So the relay works
//! behind a proxy that reuses connections, which a relay that takes whole TCP connections doesn't.

pub(crate) mod admission;
#[cfg(test)]
mod transport_test;
mod web_socket;

use std::sync::Arc;

use axum::Router;
use axum::extract::ws::{WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, Request, State};
use axum::http::{HeaderValue, StatusCode, header, request};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use iroh_relay::KeyCache;
use iroh_relay::http::{CLIENT_AUTH_HEADER, ProtocolVersion};
use iroh_relay::protos::handshake;
use iroh_relay::server::client::Config;
use iroh_relay::server::clients::Clients;
use iroh_relay::server::streams::RelayedStream;
use iroh_relay::server::{ClientRequest, DynAccessControl, Metrics};
use tokio::sync::watch;

use self::admission::Admitted;
use self::web_socket::WebSocketBytes;
use crate::header as security;

/// How many nodes' keys the relay keeps parsed, so it doesn't parse them again on every frame.
const KEY_CACHE_CAPACITY: usize = 1024;
/// The largest frame and message the relay takes: iroh-relay's own `MAX_FRAME_SIZE`, which it
/// doesn't export.
const MAX_FRAME_SIZE: usize = 1024 * 1024;

/// The relay: the nodes connected to it, and what it needs to admit more.
#[derive(Debug, Clone)]
pub(crate) struct Relay {
    clients: Clients,
    key_cache: KeyCache,
    access: Arc<dyn DynAccessControl>,
    metrics: Arc<Metrics>,
}

impl Relay {
    /// Disconnects every node, for the server's shutdown.
    pub(crate) async fn shutdown(&self) {
        self.clients.shutdown().await;
    }
}

/// Makes the relay, admitting every node for now.
///
/// # Returns
///
/// The relay, and the sender that changes who it admits.
pub(crate) fn create() -> (Relay, watch::Sender<Admitted>) {
    let (access, admitted) = admission::create();
    let relay = Relay {
        clients: Clients::default(),
        key_cache: KeyCache::new(KEY_CACHE_CAPACITY),
        access,
        metrics: Arc::new(Metrics::default()),
    };
    (relay, admitted)
}

/// The newest relay protocol version the client offers in `Sec-WebSocket-Protocol`, or none when
/// it offers none the relay speaks.
fn choose_protocol(offered: Option<&HeaderValue>) -> Option<ProtocolVersion> {
    offered?
        .to_str()
        .ok()?
        .split(',')
        .map(str::trim)
        .filter_map(ProtocolVersion::match_from_str)
        .max()
}

/// A copy of a request's method, address and headers, which the access control reads.
fn copy_parts(parts: &request::Parts) -> request::Parts {
    let mut copy = axum::http::Request::new(()).into_parts().0;
    copy.method = parts.method.clone();
    copy.uri = parts.uri.clone();
    copy.version = parts.version;
    copy.headers = parts.headers.clone();
    copy
}

/// Takes an upgraded connection through the relay's handshake and access control, and hands it to
/// the relay's registry, which serves it from then on.
async fn accept(
    relay: Relay,
    socket: WebSocket,
    parts: request::Parts,
    protocol: ProtocolVersion,
    client_auth: Option<HeaderValue>,
) {
    let mut io = WebSocketBytes(socket);
    let authentication = match handshake::serverside(&mut io, client_auth).await {
        Ok(authentication) => authentication,
        Err(error) => {
            tracing::debug!(%error, "a node failed the relay's handshake");
            return;
        }
    };
    let request = ClientRequest::new(authentication.client_key, protocol, parts);
    let guard = match authentication
        .authorize_with(&request, &relay.access, &mut io)
        .await
    {
        Ok(guard) => guard,
        Err(error) => {
            tracing::debug!(%error, "the relay didn't admit a node");
            return;
        }
    };
    let stream = RelayedStream::new(io, relay.key_cache.clone());
    relay
        .clients
        .register(Config::new(guard, stream, protocol), relay.metrics.clone());
}

/// Upgrades a request for `/relay` to a WebSocket in the newest protocol version both sides speak.
async fn upgrade(State(relay): State<Relay>, request: Request) -> Response {
    let (mut parts, _) = request.into_parts();
    let Some(protocol) = choose_protocol(parts.headers.get(header::SEC_WEBSOCKET_PROTOCOL)) else {
        return (
            StatusCode::BAD_REQUEST,
            format!(
                "The relay speaks the protocols {}.",
                ProtocolVersion::all_joined()
            ),
        )
            .into_response();
    };

    let websocket = match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
        Ok(websocket) => websocket,
        Err(rejection) => return rejection.into_response(),
    };
    let client_auth = parts.headers.get(CLIENT_AUTH_HEADER).cloned();
    let copy = copy_parts(&parts);
    websocket
        .protocols([protocol.to_str()])
        .max_frame_size(MAX_FRAME_SIZE)
        .max_message_size(MAX_FRAME_SIZE)
        .on_upgrade(move |socket| accept(relay, socket, copy, protocol, client_auth))
}

/// The relay's probe: a node measures the relay's latency with it, and checks that it's there.
async fn answer_probe() -> Response {
    let mut response = StatusCode::OK.into_response();
    let headers = response.headers_mut();
    security::add_common(headers);
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The relay's routes, at the origin's root, as iroh asks for them: `/relay` and `/ping`.
pub(crate) fn route(relay: Relay) -> Router {
    Router::new()
        .route("/relay", any(upgrade))
        .route("/ping", get(answer_probe))
        .with_state(relay)
}

#[cfg(test)]
mod test {
    use axum::http::HeaderValue;
    use iroh_relay::http::ProtocolVersion;

    use super::choose_protocol;

    #[test]
    fn speaks_the_newest_protocol_the_client_offers() {
        let all = ProtocolVersion::all_joined();
        let newest = ProtocolVersion::all()
            .filter_map(ProtocolVersion::match_from_str)
            .max()
            .unwrap();
        let offered = HeaderValue::from_str(&all).unwrap();
        assert_eq!(choose_protocol(Some(&offered)), Some(newest));
        let unknown = HeaderValue::from_static("something-else");
        assert_eq!(choose_protocol(Some(&unknown)), None);
        assert_eq!(choose_protocol(None), None);
    }
}

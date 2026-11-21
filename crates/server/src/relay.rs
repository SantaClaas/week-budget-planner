//! The iroh relay, in the server's own process and on the app's origin, so the Content Security
//! Policy needs no new entry (see Transport under Phase 3 in docs/spec/network.md). A browser node
//! reaches it with a `fetch` to `/ping` and a WebSocket to `/relay`.
//!
//! The relay takes whole connections, not requests: [`hand_over`] gives it the TCP connection
//! whose first request asks for `/relay` (see `connection.rs`), and axum answers `/ping`.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use iroh::EndpointId;
use iroh_relay::KeyCache;
use iroh_relay::server::{Access, AccessControl, ClientRequest, Handlers, Metrics, RelayService};
use tokio::net::TcpStream;
use tokio::sync::watch;

use crate::header as security;

/// How many nodes' keys the relay keeps parsed, so it doesn't parse them again on every frame.
const KEY_CACHE_CAPACITY: usize = 1024;
/// How long a connection may take to finish its WebSocket handshake before the relay drops it.
const ESTABLISH_TIMEOUT: Duration = Duration::from_secs(30);

/// Which nodes the relay admits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Admitted {
    /// Every node, as long as no member list exists (until the mailbox, #97).
    Everyone,
    /// Only these: a group's members and the server's own node.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the mailbox's member list will set it (#97); the access control handles it already"
        )
    )]
    Only(HashSet<EndpointId>),
}

/// Whether a node may use the relay.
fn decide(admitted: &Admitted, node: EndpointId) -> Access {
    match admitted {
        Admitted::Everyone => Access::Allow,
        Admitted::Only(nodes) if nodes.contains(&node) => Access::Allow,
        Admitted::Only(_) => Access::Deny { reason: None },
    }
}

/// The relay's access control: it asks the current [`Admitted`] on every connection, so whoever
/// holds the other end of the channel changes who's admitted from then on.
#[derive(Debug)]
struct Admission(watch::Receiver<Admitted>);

impl AccessControl for Admission {
    fn on_connect(&self, request: &ClientRequest) -> impl Future<Output = Access> + Send {
        std::future::ready(decide(&self.0.borrow(), request.endpoint_id()))
    }
}

/// Makes the relay, admitting every node for now.
///
/// # Returns
///
/// The relay, and the sender that changes who it admits.
pub(crate) fn create() -> (RelayService, watch::Sender<Admitted>) {
    let (admitted, admission) = watch::channel(Admitted::Everyone);
    let relay = RelayService::new(
        Handlers::default(),
        axum::http::HeaderMap::new(),
        None,
        KeyCache::new(KEY_CACHE_CAPACITY),
        Arc::new(Admission(admission)),
        Arc::new(Metrics::default()),
    );
    (relay, admitted)
}

/// Whether a connection's first request line asks for the relay: `GET /relay`, with or without a
/// query.
pub(crate) fn is_relay_request(first_line: &[u8]) -> bool {
    let Some(rest) = first_line.strip_prefix(b"GET /relay") else {
        return false;
    };

    matches!(rest.first(), Some(b' ' | b'?'))
}

/// Gives a whole connection to the relay, which serves it until it closes.
pub(crate) async fn hand_over(relay: RelayService, stream: TcpStream) {
    relay
        .handle_connection(stream, None, ESTABLISH_TIMEOUT)
        .await;
}

/// The relay's probe: a node measures the relay's latency with it, and checks that it's there.
async fn answer_probe() -> Response {
    let mut response = StatusCode::OK.into_response();
    let headers = response.headers_mut();
    security::add_common(headers);
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The relay's route that axum answers: `/ping`, at the origin's root, as iroh asks for it.
pub(crate) fn route() -> Router {
    Router::new().route("/ping", get(answer_probe))
}

#[cfg(test)]
mod test {
    use std::collections::HashSet;

    use iroh::SecretKey;
    use iroh_relay::server::Access;

    use super::{Admitted, decide, is_relay_request};

    #[test]
    fn takes_only_a_request_for_the_relay() {
        assert!(is_relay_request(b"GET /relay HTTP/1.1"));
        assert!(is_relay_request(b"GET /relay?token=1 HTTP/1.1"));
        assert!(!is_relay_request(b"GET /relayed HTTP/1.1"));
        assert!(!is_relay_request(b"GET / HTTP/1.1"));
        assert!(!is_relay_request(b"POST /relay HTTP/1.1"));
        assert!(!is_relay_request(b"GET /relay"));
        assert!(!is_relay_request(b""));
    }

    #[test]
    fn admits_everyone_until_there_is_a_list_then_only_those_on_it() {
        let member = SecretKey::generate().public();
        let stranger = SecretKey::generate().public();
        assert_eq!(decide(&Admitted::Everyone, stranger), Access::Allow);
        let admitted = Admitted::Only(HashSet::from([member]));
        assert_eq!(decide(&admitted, member), Access::Allow);
        assert_eq!(decide(&admitted, stranger), Access::Deny { reason: None });
    }
}

//! The iroh relay, in the server's own process and on the app's origin, so the Content Security
//! Policy needs no new entry (see Transport under Phase 3 in docs/spec/network.md). A browser node
//! reaches it with a `fetch` to `/ping` and a WebSocket to `/relay`.
//!
//! `/relay` is an ordinary axum route. axum upgrades the request to a WebSocket, over HTTP/1.1 or
//! HTTP/2, and the connection then goes through iroh-relay's own handshake, access control and
//! client registry, the same steps its built-in server takes after an upgrade. So the relay works
//! behind a proxy that reuses connections, which a relay that takes whole TCP connections doesn't.

use std::collections::HashSet;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, Request, State};
use axum::http::{HeaderValue, StatusCode, header, request};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use futures_core::Stream;
use futures_sink::Sink;
use iroh::EndpointId;
use iroh_relay::http::{CLIENT_AUTH_HEADER, ProtocolVersion};
use iroh_relay::protos::handshake;
use iroh_relay::protos::streams::StreamError;
use iroh_relay::server::client::Config;
use iroh_relay::server::clients::Clients;
use iroh_relay::server::streams::RelayedStream;
use iroh_relay::server::{Access, AccessControl, ClientRequest, DynAccessControl, Metrics};
use iroh_relay::{ExportKeyingMaterial, KeyCache};
use n0_error::AnyError;
use tokio::sync::watch;

use crate::header as security;

/// How many nodes' keys the relay keeps parsed, so it doesn't parse them again on every frame.
const KEY_CACHE_CAPACITY: usize = 1024;
/// The largest frame and message the relay takes: iroh-relay's own `MAX_FRAME_SIZE`, which it
/// doesn't export.
const MAX_FRAME_SIZE: usize = 1024 * 1024;

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
    let (admitted, admission) = watch::channel(Admitted::Everyone);
    let relay = Relay {
        clients: Clients::default(),
        key_cache: KeyCache::new(KEY_CACHE_CAPACITY),
        access: Arc::new(Admission(admission)),
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

/// A WebSocket as iroh-relay reads and writes it: a stream and a sink of binary messages. Pings and
/// pongs are answered by the WebSocket itself and skipped here; a close ends the stream.
struct WebSocketBytes(WebSocket);

impl Stream for WebSocketBytes {
    type Item = Result<axum::body::Bytes, StreamError>;

    fn poll_next(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        loop {
            let message = match Pin::new(&mut self.0).poll_next(context) {
                Poll::Ready(message) => message,
                Poll::Pending => return Poll::Pending,
            };
            return match message {
                Some(Ok(Message::Binary(bytes))) => Poll::Ready(Some(Ok(bytes))),
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                Some(Ok(Message::Text(_))) => Poll::Ready(Some(Err(AnyError::from_display(
                    "the relay takes binary messages only",
                )))),
                Some(Ok(Message::Close(_))) | None => Poll::Ready(None),
                Some(Err(error)) => Poll::Ready(Some(Err(AnyError::from_std(error)))),
            };
        }
    }
}

impl Sink<axum::body::Bytes> for WebSocketBytes {
    type Error = StreamError;

    fn poll_ready(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.0)
            .poll_ready(context)
            .map_err(AnyError::from_std)
    }

    fn start_send(mut self: Pin<&mut Self>, bytes: axum::body::Bytes) -> Result<(), Self::Error> {
        Pin::new(&mut self.0)
            .start_send(Message::Binary(bytes))
            .map_err(AnyError::from_std)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.0)
            .poll_flush(context)
            .map_err(AnyError::from_std)
    }

    fn poll_close(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.0)
            .poll_close(context)
            .map_err(AnyError::from_std)
    }
}

impl ExportKeyingMaterial for WebSocketBytes {
    /// None: the server doesn't hold the TLS session here (a proxy may), so the handshake takes its
    /// other way, a challenge the client signs.
    fn export_keying_material<T: AsMut<[u8]>>(
        &self,
        _output: T,
        _label: &[u8],
        _context: Option<&[u8]>,
    ) -> Option<T> {
        None
    }
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
    use std::collections::HashSet;

    use axum::http::HeaderValue;
    use iroh::SecretKey;
    use iroh_relay::http::ProtocolVersion;
    use iroh_relay::server::Access;

    use super::{Admitted, choose_protocol, decide};

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

#[cfg(test)]
mod transport_test {
    use std::net::SocketAddr;
    use std::time::Duration;

    use iroh::endpoint::presets;
    use iroh::{
        Endpoint, EndpointAddr, EndpointId, RelayMap, RelayMode, RelayUrl, SecretKey, TransportAddr,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::oneshot;
    use tokio::task::JoinHandle;

    use crate::{node, relay};

    /// How long one attempt to reach a node may take.
    const ATTEMPT_TIMEOUT: Duration = Duration::from_secs(5);

    /// A running relay on the server's accept loop, and the way to stop it.
    struct Running {
        address: SocketAddr,
        stop: oneshot::Sender<()>,
        task: JoinHandle<()>,
    }

    impl Running {
        async fn stop(self) {
            self.stop.send(()).unwrap();
            self.task.await.unwrap();
        }
    }

    /// Starts the accept loop with the relay on `address` (port 0 for any free port).
    async fn start(address: SocketAddr) -> Running {
        let listener = TcpListener::bind(address).await.unwrap();
        let address = listener.local_addr().unwrap();
        let (relay, _admission) = relay::create();
        let (stop, stopped) = oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            axum::serve(listener, relay::route(relay.clone()))
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await
                .unwrap();
            relay.shutdown().await;
        });
        Running {
            address,
            stop,
            task,
        }
    }

    fn create_relay_url(address: SocketAddr) -> RelayUrl {
        format!("http://{address}").parse().unwrap()
    }

    /// A node like the browser's: our relay only, no address lookup.
    async fn spawn_client(relay_url: RelayUrl) -> Endpoint {
        let client = Endpoint::builder(presets::Minimal)
            .relay_mode(RelayMode::Custom(RelayMap::from(relay_url)))
            .bind()
            .await
            .unwrap();
        tokio::time::timeout(ATTEMPT_TIMEOUT, client.online())
            .await
            .unwrap();
        client
    }

    /// Sends bytes to the server's node over one stream, through the relay, and reads its answer.
    async fn echo(
        client: &Endpoint,
        server: EndpointId,
        relay_url: &RelayUrl,
        bytes: &[u8],
    ) -> Result<Vec<u8>, String> {
        let address = EndpointAddr::from_parts(server, [TransportAddr::Relay(relay_url.clone())]);
        let connection = client
            .connect(address, node::ECHO)
            .await
            .map_err(|error| error.to_string())?;
        let (mut send, mut receive) = connection
            .open_bi()
            .await
            .map_err(|error| error.to_string())?;
        send.write_all(bytes)
            .await
            .map_err(|error| error.to_string())?;
        send.finish().map_err(|error| error.to_string())?;
        let answer = receive
            .read_to_end(1024)
            .await
            .map_err(|error| error.to_string())?;
        connection.close(0u32.into(), b"done");
        Ok(answer)
    }

    #[tokio::test]
    async fn echoes_bytes_through_the_relay_to_the_server_s_node() {
        let running = start("127.0.0.1:0".parse().unwrap()).await;
        let relay_url = create_relay_url(running.address);
        let server = node::spawn(SecretKey::generate(), relay_url.clone())
            .await
            .unwrap();
        let client = spawn_client(relay_url.clone()).await;

        let answer = tokio::time::timeout(
            ATTEMPT_TIMEOUT,
            echo(&client, server.endpoint().id(), &relay_url, b"a block"),
        )
        .await
        .unwrap();
        assert_eq!(answer.unwrap(), b"a block");

        client.close().await;
        server.shutdown().await.unwrap();
        running.stop().await;
    }

    #[tokio::test]
    async fn answers_the_relay_s_probe() {
        let running = start("127.0.0.1:0".parse().unwrap()).await;
        let mut stream = TcpStream::connect(running.address).await.unwrap();
        stream
            .write_all(b"GET /ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        running.stop().await;
    }

    #[tokio::test]
    async fn reaches_the_server_s_node_again_after_the_relay_drops_and_comes_back() {
        let running = start("127.0.0.1:0".parse().unwrap()).await;
        let address = running.address;
        let relay_url = create_relay_url(address);
        let server = node::spawn(SecretKey::generate(), relay_url.clone())
            .await
            .unwrap();
        let client = spawn_client(relay_url.clone()).await;
        let server_id = server.endpoint().id();
        let before = tokio::time::timeout(
            ATTEMPT_TIMEOUT,
            echo(&client, server_id, &relay_url, b"before"),
        )
        .await
        .unwrap();
        assert_eq!(before.unwrap(), b"before");

        running.stop().await;
        let running = start(address).await;

        // Both nodes reconnect to the relay on their own, after a backoff, so try until they have.
        let again = tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                let attempt = tokio::time::timeout(
                    ATTEMPT_TIMEOUT,
                    echo(&client, server_id, &relay_url, b"again"),
                )
                .await;
                if let Ok(Ok(answer)) = attempt {
                    return answer;
                }

                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(again, b"again");

        client.close().await;
        server.shutdown().await.unwrap();
        running.stop().await;
    }
}

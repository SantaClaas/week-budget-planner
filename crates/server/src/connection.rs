//! Accepting connections on the server's one port. A connection whose first request asks for
//! `/relay` goes whole to the relay, which upgrades it to a WebSocket and keeps it; every other
//! connection is served by axum. A browser opens each WebSocket on a connection of its own, so its
//! upgrade is always that connection's first request.
//!
//! The first request line is read with `peek`, which leaves it in the socket for whoever takes the
//! connection: the relay only takes a whole, untouched `TcpStream`.

use std::future::Future;
use std::io;
use std::time::Duration;

use axum::Router;
use hyper_util::rt::TokioIo;
use hyper_util::server::graceful::{GracefulShutdown, Watcher};
use hyper_util::service::TowerToHyperService;
use iroh_relay::server::RelayService;
use tokio::net::{TcpListener, TcpStream};

use crate::relay;

/// The longest first request line that's read before deciding: one for the relay is short, so a
/// longer one is axum's.
const REQUEST_LINE_LIMIT: usize = 256;
/// How long a new connection has to send its first request line.
const REQUEST_LINE_TIMEOUT: Duration = Duration::from_secs(10);
/// How often to look again while the first request line is still arriving.
const PEEK_INTERVAL: Duration = Duration::from_millis(5);
/// How long open requests may take to finish once the server is told to stop.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

/// The connection's first bytes, up to the end of its first line or [`REQUEST_LINE_LIMIT`],
/// without taking them out of the socket. Empty when the connection closed first.
async fn peek_request_line(stream: &TcpStream) -> io::Result<Vec<u8>> {
    let mut buffer = [0; REQUEST_LINE_LIMIT];
    loop {
        let length = stream.peek(&mut buffer).await?;
        let peeked = &buffer[..length];
        if length == 0 || length == buffer.len() || peeked.windows(2).any(|pair| pair == b"\r\n") {
            return Ok(peeked.to_vec());
        }

        // Part of the line is there: peek would give it back at once, so wait a little first.
        tokio::time::sleep(PEEK_INTERVAL).await;
    }
}

/// Serves one connection: through the relay, or through axum until it closes.
async fn serve_connection(
    stream: TcpStream,
    router: Router,
    relay: RelayService,
    watcher: Watcher,
) {
    let first_line =
        match tokio::time::timeout(REQUEST_LINE_TIMEOUT, peek_request_line(&stream)).await {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => {
                tracing::debug!(%error, "couldn't read a connection's first request");
                return;
            }
            Err(_) => {
                tracing::debug!("a connection sent no request in time");
                return;
            }
        };
    if relay::is_relay_request(&first_line) {
        relay::hand_over(relay, stream).await;
        return;
    }

    let service = TowerToHyperService::new(router);
    let connection =
        hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service);
    if let Err(error) = watcher.watch(connection).await {
        tracing::debug!(%error, "a connection ended with an error");
    }
}

/// Accepts connections until `shutdown` completes, then stops taking new ones, lets open requests
/// finish for up to [`SHUTDOWN_TIMEOUT`] and disconnects the relay's nodes. A failed accept is
/// logged and the loop goes on, since one, such as too many open files, shouldn't stop the server.
pub(crate) async fn serve(
    listener: TcpListener,
    router: Router,
    relay: RelayService,
    shutdown: impl Future<Output = ()>,
) {
    let graceful = GracefulShutdown::new();
    tokio::pin!(shutdown);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let stream = match accepted {
                    Ok((stream, _)) => stream,
                    Err(error) => {
                        tracing::warn!(%error, "couldn't accept a connection");
                        continue;
                    }
                };
                tokio::spawn(serve_connection(stream, router.clone(), relay.clone(), graceful.watcher()));
            }
            () = &mut shutdown => break,
        }
    }

    drop(listener);
    relay.shutdown().await;
    if tokio::time::timeout(SHUTDOWN_TIMEOUT, graceful.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("open requests didn't finish in time");
    }
}

#[cfg(test)]
mod test {
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

    use super::serve;
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
        let task = tokio::spawn(serve(listener, relay::route(), relay, async {
            let _ = stopped.await;
        }));
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
    async fn answers_other_requests_on_the_same_port_through_axum() {
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

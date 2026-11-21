//! The relay, the server's node and a node like the browser's, together on this machine: what the
//! browser's side will rely on, end to end.

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

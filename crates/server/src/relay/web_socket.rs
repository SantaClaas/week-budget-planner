//! axum's WebSocket as iroh-relay reads and writes a connection. iroh-relay's own server upgrades
//! the connection itself; here axum does, so the relay's handshake and registry get this adapter
//! instead.

use std::pin::Pin;
use std::task::{Context, Poll};

use axum::extract::ws::{Message, WebSocket};
use futures_core::Stream;
use futures_sink::Sink;
use iroh_relay::ExportKeyingMaterial;
use iroh_relay::protos::streams::StreamError;
use n0_error::AnyError;

/// A WebSocket as iroh-relay reads and writes it: a stream and a sink of binary messages. Pings and
/// pongs are answered by the WebSocket itself and skipped here; a close ends the stream.
pub(super) struct WebSocketBytes(pub(super) WebSocket);

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

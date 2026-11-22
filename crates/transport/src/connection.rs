//! A connection to another node, and the streams on it: what the app sends and receives bytes on.

use iroh::endpoint::{RecvStream, SendStream};
use n0_future::time::Duration;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::failure::{Failure, Type, run_within};

/// A connection to another node, through the relay, for one protocol.
#[wasm_bindgen]
pub struct Connection(iroh::endpoint::Connection);

impl Connection {
    pub(crate) fn new(connection: iroh::endpoint::Connection) -> Self {
        Self(connection)
    }
}

#[wasm_bindgen]
impl Connection {
    /// Opens a stream that both sides send on.
    ///
    /// * `timeout` - The deadline in milliseconds.
    ///
    /// # Errors
    ///
    /// [`Type::Timeout`], or [`Type::Closed`] when the connection is closed.
    pub async fn open(&self, timeout: u32) -> Result<Stream, Failure> {
        let (send, receive) = run_within(
            Duration::from_millis(timeout.into()),
            Type::Closed,
            self.0.open_bi(),
        )
        .await?;
        Ok(Stream { send, receive })
    }

    /// Closes the connection and every stream on it, without waiting for the other side.
    pub fn close(&self) {
        self.0.close(0u32.into(), b"closed");
    }
}

/// A stream on a connection: bytes go both ways, in order.
#[wasm_bindgen]
pub struct Stream {
    send: SendStream,
    receive: RecvStream,
}

#[wasm_bindgen]
impl Stream {
    /// Sends bytes, waiting until the stream has taken them all.
    ///
    /// * `timeout` - The deadline in milliseconds.
    ///
    /// # Errors
    ///
    /// [`Type::Timeout`], or [`Type::Closed`] when the stream or its connection is closed.
    pub async fn send(&mut self, bytes: Vec<u8>, timeout: u32) -> Result<(), Failure> {
        run_within(
            Duration::from_millis(timeout.into()),
            Type::Closed,
            self.send.write_all(&bytes),
        )
        .await
    }

    /// Tells the other side that nothing more comes on this stream. What was sent is still
    /// delivered.
    ///
    /// # Errors
    ///
    /// [`Type::Closed`] when the stream was finished or closed already.
    pub fn finish(&mut self) -> Result<(), Failure> {
        self.send
            .finish()
            .map_err(|error| Failure::new(Type::Closed, error))
    }

    /// The next bytes the other side sent, at most `limit` of them, or none once it finished.
    ///
    /// * `timeout` - The deadline in milliseconds.
    ///
    /// # Errors
    ///
    /// [`Type::Timeout`], or [`Type::Closed`] when the stream or its connection is closed.
    pub async fn receive(&mut self, limit: u32, timeout: u32) -> Result<Option<Vec<u8>>, Failure> {
        let limit = usize::try_from(limit).unwrap_or(usize::MAX);
        let chunk = run_within(
            Duration::from_millis(timeout.into()),
            Type::Closed,
            self.receive.read_chunk(limit),
        )
        .await?;
        Ok(chunk.map(|bytes| bytes.to_vec()))
    }
}

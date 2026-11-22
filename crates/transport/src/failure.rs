//! What went wrong, as a value the app can tell apart and put into words ("Can't reach the
//! server"), instead of an exception with only a message. Every call in this crate that can fail
//! gives back a [`Failure`], and every call that waits on the network has a deadline, since iroh
//! waits silently when it's blocked (see Transport under Phase 3 in docs/spec/network.md).

use std::fmt::Display;
use std::future::Future;

use n0_future::time::{self, Duration};
use wasm_bindgen::prelude::wasm_bindgen;

/// What type of failure it was: what the app decides on.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Type {
    /// The deadline passed first: the relay or the other node didn't answer in time, or something
    /// between them blocks the connection.
    Timeout = "timeout",
    /// The node couldn't start, or the other node couldn't be reached through the relay.
    Unreachable = "unreachable",
    /// The connection or the stream was closed, by either side, or broke.
    Closed = "closed",
    /// An argument wasn't valid: a key, a node id or a relay URL.
    Invalid = "invalid",
}

/// A failure: its type, and a message for the console, not for people. JavaScript reads the type as
/// `failure.type`, the name the app's TypeScript gives the field that tells values apart.
#[wasm_bindgen]
#[derive(Debug)]
pub struct Failure {
    r#type: Type,
    message: String,
}

#[wasm_bindgen]
impl Failure {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn r#type(&self) -> Type {
        self.r#type
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn message(&self) -> String {
        self.message.clone()
    }
}

impl Failure {
    pub(crate) fn new(r#type: Type, error: impl Display) -> Self {
        Self {
            r#type,
            message: error.to_string(),
        }
    }
}

/// Runs a step that can fail, within a deadline.
///
/// * `deadline` - How long the step may take, from the app.
/// * `r#type` - What a failure of the step itself is.
///
/// # Errors
///
/// [`Type::Timeout`] when the deadline passes first, or `r#type` when the step fails.
pub(crate) async fn run_within<Value, Error: Display>(
    deadline: Duration,
    r#type: Type,
    step: impl Future<Output = Result<Value, Error>>,
) -> Result<Value, Failure> {
    time::timeout(deadline, step)
        .await
        .map_err(|_| Failure::new(Type::Timeout, format!("no answer within {deadline:?}")))?
        .map_err(|error| Failure::new(r#type, error))
}

#[cfg(test)]
mod test {
    use std::future::{pending, ready};

    use n0_future::time::Duration;

    use super::{Type, run_within};

    #[tokio::test]
    async fn gives_the_value_of_a_step_in_time() {
        let outcome = run_within(
            Duration::from_millis(1000),
            Type::Closed,
            ready(Ok::<_, String>(7)),
        )
        .await;
        assert_eq!(outcome.unwrap(), 7);
    }

    #[tokio::test]
    async fn names_a_failed_step_with_its_type() {
        let failure = run_within(
            Duration::from_millis(1000),
            Type::Unreachable,
            ready(Err::<(), _>("refused")),
        )
        .await
        .unwrap_err();
        assert_eq!(failure.r#type(), Type::Unreachable);
        assert_eq!(failure.message(), "refused");
    }

    #[tokio::test]
    async fn times_out_instead_of_waiting_forever() {
        let failure = run_within(
            Duration::from_millis(10),
            Type::Closed,
            pending::<Result<(), String>>(),
        )
        .await
        .unwrap_err();
        assert_eq!(failure.r#type(), Type::Timeout);
    }
}

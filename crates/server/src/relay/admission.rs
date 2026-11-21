//! Who the relay admits. iroh-relay asks its access control on every connection; here that asks
//! the current [`Admitted`], which whoever holds the channel's sender changes, so the mailbox's
//! member list (#97) can change who's admitted while the relay runs.

use std::collections::HashSet;
use std::sync::Arc;

use iroh::EndpointId;
use iroh_relay::server::{Access, AccessControl, ClientRequest, DynAccessControl};
use tokio::sync::watch;

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

/// Makes the access control, admitting every node for now.
///
/// # Returns
///
/// The access control for the relay, and the sender that changes who it admits.
pub(super) fn create() -> (Arc<dyn DynAccessControl>, watch::Sender<Admitted>) {
    let (admitted, admission) = watch::channel(Admitted::Everyone);
    (Arc::new(Admission(admission)), admitted)
}

#[cfg(test)]
mod test {
    use std::collections::HashSet;

    use iroh::SecretKey;
    use iroh_relay::server::Access;

    use super::{Admitted, decide};

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

/**
 * The version of the messages between tabs, which every message carries as `protocolVersion`. A
 * tab never interprets a message of another version. Bump it by hand, like an IndexedDB version,
 * for a change an older tab can't read, and freeze the new messages next to the old ones. The
 * compatibility test fails until both are done (see "Tabs on different versions" in
 * docs/spec/persistence.md).
 */
export const PROTOCOL_VERSION = 1;

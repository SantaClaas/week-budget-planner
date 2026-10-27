/**
 * What a call that can fail gives back: the value, or what went wrong (`"too-small"`, `"empty"`).
 * The caller tells them apart with a comparison, as with any union.
 *
 * Like Rust's `Result`, it must be used: `pnpm typecheck` fails where a call's `Result` is thrown
 * away, unless `void` in front of the call says that is on purpose (see Results in
 * docs/guidelines/typescript.md).
 */
export type Result<Value, Problem> = Value | Problem;

// Node 22 has neither Temporal nor Intl.DurationFormat, so tests load the same polyfills as old
// browsers do.
import { loadPolyfills } from "./src/polyfills.ts";

await loadPolyfills();

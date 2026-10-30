// Node 22 has neither Temporal nor Intl.DurationFormat, so tests load the same polyfills as old
// browsers do.
import { loadPolyfills } from "./src/polyfill/index.ts";

await loadPolyfills();

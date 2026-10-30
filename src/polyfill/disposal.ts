// What `using` and `await using` need at runtime, in one chunk: the symbols that mark a disposable
// object, and the stacks that adopt or defer cleanups (see docs/spec/browser-support.md).
/* oxlint-disable import/no-unassigned-import -- each import installs a global. */
import "core-js/es/symbol/dispose.js";
import "core-js/es/symbol/async-dispose.js";
import "core-js/es/disposable-stack/index.js";
import "core-js/es/async-disposable-stack/index.js";

import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config.ts";

// The tests a mutation run uses (pnpm mutate, see Mutation testing in docs/guidelines/tests.md):
// all of them but the merge's simulation. Mutation testing and simulation are two tools. The
// simulation runs hundreds of seeded weeks to find what nobody thought of, and run again for each
// of a thousand mutants it took a run from two minutes to twenty, while the named tests already
// say which rule a mutant broke.
export default mergeConfig(
  base,
  defineConfig({ test: { exclude: ["src/merge/simulation.test.ts"] } }),
);

// Mutation testing with StrykerJS (pnpm mutate), see Mutation testing in docs/guidelines/tests.md.
// It changes the code a little at a time (a `<` to `<=`, a condition to `true`) and runs the tests:
// a change no test notices is a rule that no test pins down.
//
// A .mjs file, because Stryker only loads its config as JavaScript or JSON.

export default {
  // Named, because Stryker's own search for plugins doesn't look inside pnpm's node_modules.
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  // The pure core, where a test is input and expected output. Components and the code at the
  // edges are left out: mutating them gives noise, and their tests are slower.
  mutate: ["src/plan/**/*.ts", "!src/plan/**/*.test.ts", "!src/plan/test-data.ts"],
  // Stryker runs the tests in a copy of the repository. The skill folders hold a symlink to a
  // folder, which the copy fails on, and the others are build output.
  ignorePatterns: [".claude", ".agents", "dist", "playwright-report", "test-results"],
  // A file that doesn't exist, on purpose. Stryker would rewrite the paths in tsconfig.json for
  // the copy through TypeScript's JavaScript API, which TypeScript 7 no longer has, and the paths
  // need no rewriting, since nothing points outside the repository.
  tsconfigFile: "tsconfig.not-rewritten.json",
  reporters: ["clear-text", "progress", "html"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  tempDirName: ".stryker-tmp",
  // The mutants in constants (SLOT, the palette) need every test run, which is most of the time
  // a run takes. They stay in: those constants are rules too, and a run is about two minutes.
  warnings: { slow: false },
  // No score to reach: the survivors are read, not counted (see the guideline).
  thresholds: { high: 100, low: 0, break: null },
};

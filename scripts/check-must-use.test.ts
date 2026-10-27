import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { check } from "./check-must-use.ts";

// A small project of its own, so each case sits on a known line. The check asks TypeScript's
// unstable API, so these cases are also what has to keep working when TypeScript is updated.
const CODE = `type Result<Value, Problem> = Value | Problem;
const parse = (text: string): Result<number, "empty"> => (text ? 1 : "empty");
const load = async (): Promise<Result<number, "gone">> => await Promise.resolve(1);
/** @mustUse */
const subscribe = (): (() => void) => () => {};
type Store = {
  /** @mustUse Gives back the function that stops watching. */
  watch(callback: () => void): () => void;
};
export async function run(store: Store, optional?: Store): Promise<number> {
  parse("a");
  (parse("b"));
  await load();
  subscribe();
  store.watch(() => {});
  optional?.watch(() => {});
  void parse("c");
  void (await load());
  [1].push(2);
  const used = parse("d");
  return typeof used === "number" ? used : 0;
}
`;

const folder = mkdtempSync(join(tmpdir(), "check-must-use-"));
writeFileSync(
  join(folder, "tsconfig.json"),
  JSON.stringify({ references: [{ path: "./code.json" }] }),
);
writeFileSync(
  join(folder, "code.json"),
  JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, files: ["code.ts"] }),
);
writeFileSync(join(folder, "code.ts"), CODE);
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("the must-use check", () => {
  const findings = check(folder);

  it("finds every thrown-away Result and @mustUse value, awaited or not", () => {
    expect(findings.map(({ file, line, column }) => `${file}:${line}:${column}`)).toEqual([
      "code.ts:11:3",
      "code.ts:12:3",
      "code.ts:13:3",
      "code.ts:14:3",
      "code.ts:15:3",
      "code.ts:16:3",
    ]);
  });

  it("says which kind of value was thrown away", () => {
    expect(findings[0]?.message).toContain('its Result (Result<number, "empty">)');
    expect(findings[2]?.message).toContain('its Result (Result<number, "gone">)');
    expect(findings[3]?.message).toContain("a value marked @mustUse");
  });
});

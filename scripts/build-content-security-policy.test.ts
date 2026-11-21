import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POLICY_FILE, buildPolicyFile } from "./build-content-security-policy.ts";

describe("the committed Content Security Policy", () => {
  it("is current with index.html's inline scripts (run pnpm policy)", () => {
    const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(readFileSync(POLICY_FILE, "utf8")).toBe(buildPolicyFile(index));
  });

  it("hashes each inline script, and only those", () => {
    const page = '<script>let a;</script><script type="module" src="/b.js"></script>';
    const policy = buildPolicyFile(page);
    expect(policy.match(/'sha256-[^']+'/gu)).toHaveLength(1);
    expect(policy.trimEnd()).toMatch(/; frame-ancestors 'none'$/u);
  });
});

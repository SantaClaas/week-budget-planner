import { describe, expect, it } from "vitest";

import { buildBindings, hashIntegrity } from "./transport.ts";

describe("hashIntegrity", () => {
  it("is the SHA-384 a fetch's integrity checks, in base64", () => {
    // The SHA-384 of no bytes, as `openssl dgst -sha384 -binary | base64` gives it.
    expect(hashIntegrity(new Uint8Array())).toBe(
      "sha384-OLBgp1GsljhM2TJ+sbHjaiH9txEUvgdDTAzHv2P24donTt6/529l+9Ua0vFImLlb",
    );
  });
});

describe("buildBindings", () => {
  it("gives the module's URL through Vite, so it gets a hash in its name, and its integrity", () => {
    const code = buildBindings("sha384-abc");
    expect(code).toContain('import url from "/target/transport-module/transport_bg.wasm?url";');
    expect(code).toContain('integrity: "sha384-abc"');
    expect(code).toContain("export const bindings = {");
  });
});

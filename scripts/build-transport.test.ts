import { describe, expect, it } from "vitest";

import { findLockedVersion } from "./build-transport.ts";

describe("findLockedVersion", () => {
  const lockfile = [
    "[[package]]",
    'name = "wasm-bindgen"',
    'version = "0.2.130"',
    "",
    "[[package]]",
    'name = "wasm-bindgen-futures"',
    'version = "0.4.80"',
  ].join("\n");

  it("finds a crate's version by its exact name", () => {
    expect(findLockedVersion(lockfile, "wasm-bindgen")).toBe("0.2.130");
    expect(findLockedVersion(lockfile, "wasm-bindgen-futures")).toBe("0.4.80");
  });

  it("gives nothing for a crate that isn't there, or only shares the start of a name", () => {
    expect(findLockedVersion(lockfile, "wasm")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { parseDeviceKey, parseDeviceName, parseMembership, parseRelay } from "./index.ts";

describe("a device's key", () => {
  it("is 64 lowercase hexadecimal digits, as iroh writes a node id", () => {
    const key = "0123456789abcdef".repeat(4);
    expect(parseDeviceKey(key)).toBe(key);
    expect(parseDeviceKey(key.toUpperCase())).toBeUndefined();
    expect(parseDeviceKey(key.slice(1))).toBeUndefined();
    expect(parseDeviceKey(`${key}0`)).toBeUndefined();
    expect(parseDeviceKey(64)).toBeUndefined();
  });
});

describe("a relay", () => {
  it.each(["https://relay.example/", "http://localhost:8080/relay", "https://relay.example/?a=1"])(
    "accepts %s",
    (relay) => {
      expect(parseRelay(relay)).toBe(relay);
    },
  );

  it.each([
    "https://relay.example",
    "HTTPS://relay.example/",
    "wss://relay.example/",
    "relay.example",
    "",
    `https://relay.example/${"x".repeat(179)}`,
  ])("refuses %j", (relay) => {
    expect(parseRelay(relay)).toBeUndefined();
  });

  it("keeps a URL of exactly 200 characters", () => {
    const relay = `https://relay.example/${"x".repeat(178)}`;
    expect(relay).toHaveLength(200);
    expect(parseRelay(relay)).toBe(relay);
  });
});

describe("a device's name", () => {
  it("is trimmed and 1 to 60 code points long", () => {
    expect(parseDeviceName("Firefox on Linux")).toBe("Firefox on Linux");
    expect(parseDeviceName("🦊".repeat(60))).toBe("🦊".repeat(60));
    expect(parseDeviceName("🦊".repeat(61))).toBeUndefined();
    expect(parseDeviceName("")).toBeUndefined();
    expect(parseDeviceName(" Phone")).toBeUndefined();
    expect(parseDeviceName(null)).toBeUndefined();
  });
});

describe("a membership", () => {
  it("has a known status, and no proof until the passkey guard comes", () => {
    expect(parseMembership("member", null)).toEqual({ status: "member", proof: null });
    expect(parseMembership("removed", null)).toEqual({ status: "removed", proof: null });
    expect(parseMembership("temporary", null)).toEqual({ status: "temporary", proof: null });
    expect(parseMembership("admin", null)).toBeUndefined();
    expect(parseMembership("member", "signature")).toBeUndefined();
    expect(parseMembership("member", "")).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION } from "./protocol/index.ts";
import { consume, ProviderMissingError, provide, RemoteCallError } from "./service.ts";

// The proxy leans on behavior TypeScript can't check: a Proxy answers any method name, errors lose
// their class when they're cloned, and a missing provider shows only as silence. These tests pin
// that down (see Where rules are enforced in docs/guidelines/principles.md).

// Every method of a consumed API can answer "newer-version" (see consume).
type Calculator = {
  add(first: number, second: number): Promise<number | "newer-version">;
  fail(): Promise<"newer-version">;
};

class NamedError extends Error {
  override name = "NamedError";
}

const channels: BroadcastChannel[] = [];
function openChannel(): BroadcastChannel {
  const channel = new BroadcastChannel("week-budget-planner-test");
  channels.push(channel);
  return channel;
}

// Each test's providers serve until afterEach closes its channels, so their stop functions are
// thrown away on purpose.
afterEach(() => {
  vi.useRealTimers();
  for (const channel of channels.splice(0)) channel.close();
});

describe("broadcast service", () => {
  it("runs a call on the providing side and returns its result", async () => {
    void provide(openChannel(), "test", {
      add: (first: number, second: number) => Promise.resolve(first + second),
    });
    const { proxy } = consume<Calculator>(openChannel(), "test");
    await expect(proxy.add(2, 3)).resolves.toBe(5);
  });

  it("isn't mistaken for a promise when awaited", async () => {
    const { proxy } = consume<Calculator>(openChannel(), "test");
    // Awaiting looks up `then`. If the proxy answered it like a method, this would never settle.
    await expect(Promise.resolve(proxy)).resolves.toBe(proxy);
  });

  it("keeps an error's name across tabs, which cloning alone drops", async () => {
    void provide(openChannel(), "test", {
      fail: () => Promise.reject(new NamedError("on purpose")),
    });
    const { proxy } = consume<Calculator>(openChannel(), "test");
    const error: unknown = await proxy.fail().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RemoteCallError);
    expect(error).toHaveProperty("cause.name", "NamedError");
    expect(error).toHaveProperty("cause.message", "on purpose");
  });

  it("only consumes an API whose every method can answer newer-version", () => {
    type Strict = { add(first: number, second: number): Promise<number> };
    // @ts-expect-error -- add can't give back "newer-version", which a refused call answers with.
    expect(consume<Strict>(openChannel(), "test").proxy).toBeDefined();
  });

  it("answers its open calls and later ones with newer-version once a newer protocol answers", async () => {
    const other = openChannel();
    other.addEventListener("message", () => {
      other.postMessage({
        protocolVersion: PROTOCOL_VERSION + 1,
        scope: "test",
        type: "provider-ready",
        providerId: "newer",
      });
    });
    let newerVersions = 0;
    const { proxy } = consume<Calculator>(openChannel(), "test", {
      onNewerVersion: () => {
        newerVersions++;
      },
    });
    await expect(proxy.add(1, 1)).resolves.toBe("newer-version");
    expect(newerVersions).toBeGreaterThan(0);
    await expect(proxy.add(2, 2)).resolves.toBe("newer-version");
  });

  it("hands over to a newer protocol version, and stops serving when told", async () => {
    let newerVersions = 0;
    const stopServing = provide(
      openChannel(),
      "test",
      { add: (first: number, second: number) => Promise.resolve(first + second) },
      {
        onNewerVersion: () => {
          newerVersions++;
        },
      },
    );
    const newer = openChannel();
    newer.postMessage({
      protocolVersion: PROTOCOL_VERSION + 1,
      scope: "test",
      type: "provider-query",
    });
    await expect.poll(() => newerVersions).toBe(1);
    stopServing();
    const { proxy } = consume<Calculator>(openChannel(), "test");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const outcome = proxy.add(1, 1).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(await outcome).toBeInstanceOf(ProviderMissingError);
  });

  it("tells a tab on an older protocol version that it's outdated", async () => {
    void provide(openChannel(), "test", { add: () => Promise.resolve(0) });
    const older = openChannel();
    const versions: unknown[] = [];
    older.addEventListener("message", (event: MessageEvent<{ protocolVersion: unknown }>) => {
      versions.push(event.data.protocolVersion);
    });
    older.postMessage({
      protocolVersion: PROTOCOL_VERSION - 1,
      scope: "test",
      type: "provider-query",
    });
    await expect.poll(() => versions).toContain(PROTOCOL_VERSION);
  });

  it("gives up with ProviderMissingError when no provider answers for 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const { proxy } = consume<Calculator>(openChannel(), "test");
    // Caught right away, so the rejection is handled while the timers run.
    const outcome = proxy.add(1, 1).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(await outcome).toBeInstanceOf(ProviderMissingError);
  });
});

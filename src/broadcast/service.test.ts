import { afterEach, describe, expect, it, vi } from "vitest";

import { consume, ProviderMissingError, provide, RemoteCallError } from "./service.ts";

// The proxy leans on behavior TypeScript can't check: a Proxy answers any method name, errors lose
// their class when they're cloned, and a missing provider shows only as silence. These tests pin
// that down (see Where rules are enforced in docs/CODING-GUIDELINES.md).

type Calculator = {
  add(first: number, second: number): Promise<number>;
  fail(): Promise<never>;
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

afterEach(() => {
  vi.useRealTimers();
  for (const channel of channels.splice(0)) channel.close();
});

describe("broadcast service", () => {
  it("runs a call on the providing side and returns its result", async () => {
    provide(openChannel(), "test", {
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
    provide(openChannel(), "test", { fail: () => Promise.reject(new NamedError("on purpose")) });
    const { proxy } = consume<Calculator>(openChannel(), "test");
    const error: unknown = await proxy.fail().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RemoteCallError);
    expect(error).toHaveProperty("cause.name", "NamedError");
    expect(error).toHaveProperty("cause.message", "on purpose");
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

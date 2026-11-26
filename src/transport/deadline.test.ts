import { afterEach, describe, expect, it, vi } from "vitest";

import { CallLostError, ProviderMissingError, RemoteCallError } from "../broadcast/service.ts";
import { waitWithin } from "./deadline.ts";

/** A worker that never stops. */
const running = new Promise<"unavailable">(() => {});

afterEach(() => {
  vi.useRealTimers();
});

describe("the page's deadline on a call to the worker", () => {
  it("gives the worker's answer when it comes in time, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    await expect(waitWithin(Promise.resolve("sent"), 1000, running)).resolves.toBe("sent");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends in timeout when the worker doesn't answer before the deadline", async () => {
    vi.useFakeTimers();
    const waiting = waitWithin(new Promise<"sent">(() => {}), 1000, running);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toBe("timeout");
  });

  it("ends in timeout, not an error, when the service gives up on a silent worker first", async () => {
    // The service's silence limit (10 s) can come before a long call's deadline.
    vi.useFakeTimers();
    const lost = Promise.reject(new CallLostError("The provider of transport stopped answering."));
    await expect(waitWithin(lost, 31_000, running)).resolves.toBe("timeout");
    const missing = Promise.reject(new ProviderMissingError("No provider of transport answered."));
    await expect(waitWithin(missing, 31_000, running)).resolves.toBe("timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends in unavailable once the worker stopped", async () => {
    vi.useFakeTimers();
    const stopped = Promise.resolve<"unavailable">("unavailable");
    await expect(waitWithin(new Promise<"sent">(() => {}), 1000, stopped)).resolves.toBe(
      "unavailable",
    );
  });

  it("throws a mistake in the worker on, and still leaves no timer behind", async () => {
    vi.useFakeTimers();
    const failed = Promise.reject(new RemoteCallError("The provider failed to execute the call."));
    await expect(waitWithin(failed, 1000, running)).rejects.toBeInstanceOf(RemoteCallError);
    expect(vi.getTimerCount()).toBe(0);
  });
});

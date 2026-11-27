/**
 * The page's deadline on a call to the transport's worker: a little longer than the call's own, so
 * the worker's own "timeout" normally comes first, and this only ends a call the worker doesn't
 * answer at all.
 */
import { CallLostError, ProviderMissingError } from "../broadcast/service.ts";

/**
 * A call the broadcast service gave up on, because the worker stopped answering it (see
 * `SILENCE_LIMIT_MILLISECONDS` in src/broadcast/service.ts), as "timeout": a worker that stops
 * answering ends in "timeout", never in an error. Any other error is a mistake, and is thrown on.
 */
function readLostCall(error: unknown): "timeout" {
  if (error instanceof CallLostError || error instanceof ProviderMissingError) return "timeout";

  throw error;
}

/** A timer that clears itself when its scope ends, declared with `using`. */
type Timer = Disposable & {
  /** Resolves with "timeout" once the time is up. */
  elapsed: Promise<"timeout">;
};

function startTimer(milliseconds: number): Timer {
  const { promise: elapsed, resolve } = Promise.withResolvers<"timeout">();
  const timer = setTimeout(() => {
    resolve("timeout");
  }, milliseconds);
  return {
    elapsed,
    [Symbol.dispose]: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * The call's answer, "timeout" once `deadline` milliseconds passed or the worker stopped
 * answering, or "unavailable" once the worker stopped. The timer is cleared however it ends.
 *
 * @param stopped - Resolves once the worker stopped, with an error event.
 */
export async function waitWithin<Value>(
  call: Promise<Value>,
  deadline: number,
  stopped: Promise<"unavailable">,
): Promise<Value | "timeout" | "unavailable"> {
  using timer = startTimer(deadline);
  try {
    return await Promise.race([call, timer.elapsed, stopped]);
  } catch (error) {
    return readLostCall(error);
  }
}

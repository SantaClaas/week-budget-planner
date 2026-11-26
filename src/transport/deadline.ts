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

/**
 * The call's answer, "timeout" once `deadline` milliseconds passed or the worker stopped
 * answering, or "unavailable" once the worker stopped.
 *
 * @param stopped - Resolves once the worker stopped, with an error event.
 */
export async function waitWithin<Value>(
  call: Promise<Value>,
  deadline: number,
  stopped: Promise<"unavailable">,
): Promise<Value | "timeout" | "unavailable"> {
  const { promise: late, resolve } = Promise.withResolvers<"timeout">();
  const timer = setTimeout(() => {
    resolve("timeout");
  }, deadline);
  let answer: Value | "timeout" | "unavailable";
  try {
    answer = await Promise.race([call, late, stopped]);
  } catch (error) {
    clearTimeout(timer);
    return readLostCall(error);
  }

  clearTimeout(timer);
  return answer;
}

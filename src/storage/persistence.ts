/**
 * Persistent storage, so the browser doesn't delete the plan when it runs low on space (see Keeping
 * the data in docs/spec/persistence.md). Only call `request()` from a button in the app's own
 * explanation, never on its own: the browser may show a prompt (see Browser permissions).
 */

/** Asks the browser to keep this site's storage. Resolves to whether it will. */
export async function request(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Whether the browser keeps this site's storage until the user deletes it. */
async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * Whether the browser keeps this site's storage, may delete it, or said no when asked (see Keeping
 * the data in docs/spec/persistence.md), so the app doesn't offer to ask again after a no.
 */
export type KeepingState = "persisted" | "not-persisted" | "denied";

/** Whether the browser was asked to keep this site's storage and said no. */
async function isDenied(): Promise<boolean> {
  let status: PermissionStatus | undefined;
  try {
    status = await navigator.permissions?.query({ name: "persistent-storage" });
  } catch {
    return false;
  }
  return status?.state === "denied";
}

/** What the browser does with this site's storage now. */
export async function findState(): Promise<KeepingState> {
  if (await isPersisted()) return "persisted";
  return (await isDenied()) ? "denied" : "not-persisted";
}

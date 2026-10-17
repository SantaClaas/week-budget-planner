/**
 * Persistent storage, so the browser doesn't delete the plan when it runs low on space (see
 * Keeping the data in docs/SPEC.md).
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
export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

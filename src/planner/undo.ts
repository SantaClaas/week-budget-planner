import type { Plan } from "../plan/index.ts";

/** How many steps Undo keeps, as in the prototype (see History in docs/spec/interactions.md). */
const LIMIT = 100;

/** The undo steps with `before` added as the latest, dropping the oldest past the limit. */
export function push(steps: readonly Plan[], before: Plan): Plan[] {
  const kept = steps.length < LIMIT ? steps : steps.slice(steps.length - LIMIT + 1);
  return [...kept, before];
}

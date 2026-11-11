import * as preference from "./preference.ts";

/**
 * How much things move (see Motion in docs/spec/design.md): follow the system's
 * `prefers-reduced-motion`, or reduced or full motion. Applying it sets `data-motion` on the root
 * element, which sets `--spatial-motion`; System removes it.
 */
export type Motion = "system" | "reduced" | "full";

type Root = Pick<HTMLElement, "dataset">;

export const motion = preference.create<Motion, Root>({
  key: "week-budget-planner.motion",
  choices: ["system", "reduced", "full"],
  system: "system",
  findTarget: () => globalThis.document?.documentElement,
  apply: (root, choice) => {
    if (choice === "system") {
      delete root.dataset["motion"];
      return;
    }
    root.dataset["motion"] = choice;
  },
});

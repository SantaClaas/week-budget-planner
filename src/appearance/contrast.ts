import * as preference from "./preference.ts";

/**
 * The contrast level (see Contrast in docs/spec/design.md): follow the system's `prefers-contrast`,
 * or less, standard or more contrast. Applying it sets `data-contrast` on the root element, which
 * points the color tokens at that level; System removes it.
 */
export type Contrast = "system" | "less" | "standard" | "more";

type Root = Pick<HTMLElement, "dataset">;

export const contrast = preference.create<Contrast, Root>({
  key: "week-budget-planner.contrast",
  choices: ["system", "less", "standard", "more"],
  system: "system",
  findTarget: () => globalThis.document?.documentElement,
  apply: (root, choice) => {
    if (choice === "system") {
      delete root.dataset["contrast"];
      return;
    }
    root.dataset["contrast"] = choice;
  },
});

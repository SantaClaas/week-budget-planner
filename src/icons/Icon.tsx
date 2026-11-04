import type { JSX } from "@solidjs/web";

import type { IconName } from "./name.ts";

/**
 * A Material Symbol from the iconset (see Icons in docs/spec/design.md), hidden from screen
 * readers: the text beside it, or a visually hidden one, says what it means. Only icons in the
 * iconset compile (see src/icons/name.ts).
 */
export function Icon(properties: { name: IconName; size?: 18 | 20 }): JSX.Element {
  return (
    <svg
      class={["icon", { "size-18": properties.size === 18, "size-20": properties.size === 20 }]}
      aria-hidden="true"
    >
      <use href={`#${properties.name}`} />
    </svg>
  );
}

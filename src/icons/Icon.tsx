import type { JSX } from "@solidjs/web";

import type { IconName } from "./name.ts";

/**
 * A Material Symbol from the iconset (see Icons in docs/spec/design.md), hidden from screen
 * readers: the text beside it, or a visually hidden one, says what it means. Only icons in the
 * iconset compile (see src/icons/name.ts).
 */
export function Icon(props: { name: IconName; size?: 18 | 20 }): JSX.Element {
  return (
    <svg
      class={["icon", { "size-18": props.size === 18, "size-20": props.size === 20 }]}
      aria-hidden="true"
    >
      <use href={`#${props.name}`} />
    </svg>
  );
}

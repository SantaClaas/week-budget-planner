import type { JSX } from "@solidjs/web";

/**
 * A Material Symbol from the iconset (see Icons in docs/spec/design.md), hidden from screen
 * readers: the text beside it, or a visually hidden one, says what it means.
 */
export function Icon(props: { name: string; size?: 18 | 20 }): JSX.Element {
  return (
    <svg
      class={["icon", { "size-18": props.size === 18, "size-20": props.size === 20 }]}
      aria-hidden="true"
    >
      <use href={`#${props.name}`} />
    </svg>
  );
}

import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/name.ts";
import { createPath, DESTINATIONS, NAMES, type Destination, type Page } from "../page/index.ts";

const ICONS = {
  week: "calendar_view_week",
  activities: "checklist",
  settings: "settings",
} as const satisfies Record<Destination, IconName>;

/**
 * The links to the destinations, the same in the rail and the bar; the one shown has the filled
 * icon. On the not-found page none of them is current.
 */
export function Destinations(props: { current: Page; base: string }): JSX.Element {
  return (
    <For each={DESTINATIONS}>
      {(page) => (
        <a
          href={createPath(page, props.base)}
          class="navigation-item"
          aria-current={props.current === page ? "page" : undefined}
        >
          <span class="active-indicator">
            <Icon name={props.current === page ? `${ICONS[page]}-fill` : ICONS[page]} />
          </span>
          {NAMES[page]}
        </a>
      )}
    </For>
  );
}

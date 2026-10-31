import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import { createPath, NAMES, PAGES, type Page } from "../page/index.ts";

const ICONS = {
  week: "calendar_view_week",
  activities: "checklist",
  settings: "settings",
} as const satisfies Record<Page, string>;

/** The links to the pages, the same in the rail and the bar; the one shown has the filled icon. */
export function Destinations(props: { current: Page; base: string }): JSX.Element {
  return (
    <For each={PAGES}>
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

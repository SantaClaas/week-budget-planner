import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import type { Page } from "../page/index.ts";
import { Destinations } from "./Destinations.tsx";

/**
 * The navigation on wide screens (see Layout in docs/spec/layout.md). Its menu button expands and
 * collapses it, and the stylesheet draws both from the button's aria-expanded. Under it, the
 * "New activity" button: only its icon while the rail is collapsed, extended with its label when
 * it's expanded.
 */
export function NavigationRail(properties: {
  current: Page;
  base: string;
  onNewActivity: () => void;
  /** A tab on a newer version took over, so no activity can be added. */
  isReadOnly: boolean;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = createSignal(false);
  return (
    <nav class="navigation-rail" aria-label="Sections">
      <button
        type="button"
        class="icon-button"
        aria-expanded={isExpanded() ? "true" : "false"}
        onClick={() => {
          setIsExpanded(!isExpanded());
        }}
      >
        <Icon name={isExpanded() ? "menu_open" : "menu"} />
        <span class="visually-hidden">
          {isExpanded() ? "Collapse navigation" : "Expand navigation"}
        </span>
      </button>
      <button
        type="button"
        class="floating-action-button"
        data-icon-only={!isExpanded()}
        title={isExpanded() ? undefined : "New activity"}
        aria-disabled={properties.isReadOnly ? "true" : undefined}
        onClick={properties.onNewActivity}
      >
        <Icon name="add" />
        <span class={{ "visually-hidden": !isExpanded() }}>New activity</span>
      </button>
      <Destinations current={properties.current} base={properties.base} />
    </nav>
  );
}

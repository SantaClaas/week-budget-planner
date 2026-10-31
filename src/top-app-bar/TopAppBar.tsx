import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Icon } from "../icons/Icon.tsx";
import { createPath } from "../page/index.ts";
import type { Planner } from "../planner/index.ts";

/**
 * The page's header (see Top app bar in docs/spec/layout.md): its name as the page's heading, the
 * save status, which leads to Settings › Your data, and Undo. Without a planner yet, while the plan
 * opens, it shows only the name and a disabled Undo.
 */
export function TopAppBar(props: {
  title: string;
  base: string;
  planner: Planner | undefined;
  /** Receives the heading, which takes focus when the user moves to this page. */
  headingRef?: (heading: HTMLHeadingElement) => void;
}): JSX.Element {
  return (
    <header class="top-app-bar">
      <h1 class="title-large grow" tabindex="-1" ref={props.headingRef}>
        {props.title}
      </h1>
      {/* Not keyed, so a focused link stays focused while its text changes. */}
      <Show when={props.planner}>
        {(planner) => (
          <a
            href={createPath("settings", props.base, "your-data")}
            class="save-status button body-small"
            data-size="extra-small"
            data-variant={planner().saveStatus().variant}
            title="Your data in Settings"
          >
            <Icon name={planner().saveStatus().icon} />
            {planner().saveStatus().text}
          </a>
        )}
      </Show>
      <button
        type="button"
        class="icon-button"
        disabled={props.planner?.canUndo() !== true}
        onClick={() => {
          props.planner?.undo();
        }}
      >
        <Icon name="undo" />
        <span class="visually-hidden">Undo</span>
      </button>
    </header>
  );
}

import type { JSX } from "@solidjs/web";

import type { Page } from "../page/index.ts";
import { Destinations } from "./Destinations.tsx";

/** The navigation on phones, at the bottom (see Phones in docs/spec/layout.md). */
export function NavigationBar(props: { current: Page; base: string }): JSX.Element {
  return (
    <nav class="navigation-bar" aria-label="Sections">
      <Destinations current={props.current} base={props.base} />
    </nav>
  );
}

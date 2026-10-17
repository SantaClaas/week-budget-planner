import type { JSX } from "@solidjs/web";
import version from "virtual:app-version";

export function App(): JSX.Element {
  return (
    <main>
      <h1>Week Budget Planner</h1>
      <p>
        <a href={version.url} target="_blank" rel="noopener">
          Version {version.date}
          {version.commit === undefined ? "" : ` · ${version.commit.slice(0, 7)}`}
        </a>
      </p>
    </main>
  );
}

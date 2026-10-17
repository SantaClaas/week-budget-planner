import type { JSX } from "@solidjs/web";
import version from "virtual:app-version";

export function App(): JSX.Element {
  return (
    <main>
      <h1>Week Budget Planner</h1>
      <p>
        Version {version.date}
        {version.commit && (
          <>
            {" · "}
            <a href={version.commit.url}>{version.commit.hash.slice(0, 7)}</a>
          </>
        )}
      </p>
    </main>
  );
}

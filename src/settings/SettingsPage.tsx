import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled } from "solid-js";
import version from "virtual:app-version";

import { colorScheme } from "../appearance/color-scheme.ts";
import { contrast } from "../appearance/contrast.ts";
import { motion } from "../appearance/motion.ts";
import type { Preference } from "../appearance/preference.ts";
import { Icon } from "../icons/Icon.tsx";
import type { IconName } from "../icons/name.ts";
import type { Plan } from "../plan/index.ts";
import type { Planner } from "../planner/index.ts";
import { ClearWeek, DayHours } from "../week/WeekTools.tsx";

/** Whether the media query matches, following the browser as it changes. */
function watchMediaQuery(query: string): () => boolean {
  const list = matchMedia(query);
  const [isMatching, setIsMatching] = createSignal(list.matches);
  onSettled(() => {
    const update = (): void => {
      setIsMatching(list.matches);
    };
    list.addEventListener("change", update);
    return () => {
      list.removeEventListener("change", update);
    };
  });
  return isMatching;
}

/**
 * One Appearance setting: its title, a connected button group of its choices, and what System
 * resolves to now, which describes the System option (see Settings in
 * docs/spec/accessibility.md). A choice made in another tab shows here too.
 */
function PreferenceRow<Choice extends string, Target>(properties: {
  id: string;
  title: string;
  icon: IconName;
  preference: Preference<Choice, Target>;
  labels: Record<Choice, string>;
  /** "System is currently dark." */
  systemText: string;
  /** Contrast shows at standard contrast whatever is chosen, so it can always be read. */
  isStandardContrast?: boolean;
}): JSX.Element {
  const [current, setCurrent] = createSignal<string>(properties.preference.read());
  onSettled(() =>
    properties.preference.listenForChanges((choice) => {
      setCurrent(() => choice);
    }),
  );
  const choose = (event: Event): void => {
    if (!(event.target instanceof HTMLInputElement)) return;
    const { value } = event.target;
    const choice = properties.preference.choices.find((each) => each === value);
    if (choice === undefined) return;
    properties.preference.save(choice);
    setCurrent(() => choice);
  };
  return (
    <li
      class={properties.isStandardContrast === true ? "preference standard-contrast" : "preference"}
    >
      <Icon name={properties.icon} />
      <span id={`${properties.id}-title`} class="title body-large">
        {properties.title}
      </span>
      <fieldset
        class="connected-button-group"
        aria-labelledby={`${properties.id}-title`}
        style={{ "--choices": properties.preference.choices.length }}
        onChange={choose}
      >
        <For each={properties.preference.choices}>
          {(choice, index) => (
            <label>
              <input
                type="radio"
                name={properties.id}
                value={choice}
                checked={current() === choice}
                aria-describedby={index() === 0 ? `${properties.id}-system` : undefined}
              />
              {properties.labels[choice]}
            </label>
          )}
        </For>
      </fieldset>
      <p id={`${properties.id}-system`} class="system body-medium muted">
        {properties.systemText}
      </p>
    </li>
  );
}

/** Theme, Contrast and Motion, each following the browser unless chosen here. */
function Appearance(): JSX.Element {
  const isDark = watchMediaQuery("(prefers-color-scheme: dark)");
  const isMoreContrast = watchMediaQuery("(prefers-contrast: more)");
  const isLessContrast = watchMediaQuery("(prefers-contrast: less)");
  const isReducedMotion = watchMediaQuery("(prefers-reduced-motion: reduce)");
  const systemContrast = (): string => {
    if (isMoreContrast()) return "more";
    return isLessContrast() ? "less" : "standard";
  };
  return (
    <section class="settings-section" aria-labelledby="appearance-title">
      <h2 id="appearance-title" class="title-small emphasized">
        Appearance
      </h2>
      <ul class="segmented-list">
        <PreferenceRow
          id="theme"
          title="Theme"
          icon="dark_mode"
          preference={colorScheme}
          labels={{ "light dark": "System", light: "Light", dark: "Dark" }}
          systemText={`System is currently ${isDark() ? "dark" : "light"}.`}
        />
        <PreferenceRow
          id="contrast"
          title="Contrast"
          icon="contrast"
          preference={contrast}
          labels={{ system: "System", less: "Less", standard: "Standard", more: "More" }}
          systemText={`System is currently ${systemContrast()}.`}
          isStandardContrast
        />
        <PreferenceRow
          id="motion"
          title="Motion"
          icon="animation"
          preference={motion}
          labels={{ system: "System", reduced: "Reduced", full: "Full" }}
          systemText={`System is currently ${isReducedMotion() ? "reduced" : "full"}.`}
        />
      </ul>
    </section>
  );
}

/** The version this build is, as a link to the repository at its commit. */
function About(): JSX.Element {
  return (
    <section class="settings-section" aria-labelledby="about-title">
      <h2 id="about-title" class="title-small emphasized">
        About
      </h2>
      <ul class="segmented-list">
        <li>
          <a class="list-item" href={version.url} target="_blank" rel="noopener">
            <Icon name="mark-github" />
            <span class="grow">
              <span class="body-large">Version</span>
              <span class="body-medium muted">
                {version.date}
                {version.commit === undefined ? "" : ` · ${version.commit.slice(0, 7)}`}
              </span>
            </span>
            <Icon name="open_in_new" />
            <span class="visually-hidden">Opens in a new tab</span>
          </a>
        </li>
      </ul>
    </section>
  );
}

/**
 * The Settings page (see Settings page in docs/spec/layout.md): Appearance, then the Week tools on
 * phones, where they aren't above the week, and About last. The sections are the page's own
 * parts, which <main> lays out in its column.
 */
export function SettingsPage(properties: { plan: Plan; planner: Planner }): JSX.Element {
  return (
    <>
      <Appearance />
      <section class="settings-section for-narrow-window" aria-labelledby="week-settings-title">
        <h2 id="week-settings-title" class="title-small emphasized">
          Week
        </h2>
        <ul class="segmented-list">
          <li>
            <DayHours plan={properties.plan} planner={properties.planner} variant="list-item" />
          </li>
          <li>
            <ClearWeek plan={properties.plan} planner={properties.planner} variant="list-item" />
          </li>
        </ul>
      </section>
      <About />
    </>
  );
}

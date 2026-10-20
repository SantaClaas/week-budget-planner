---
paths:
  - "**/*.test.ts"
  - "e2e/**"
---

# Tests

What gets a test and how the tests run. It adds to [`docs/guidelines/principles.md`](principles.md), which always applies; its "Where rules are enforced" says which stage catches what, and why an exception to the type checks owes a test.

**Test where a test adds something.** Coverage numbers are a metric, not the goal. Once a measure becomes a target, it stops being a good measure ([Goodhart's law](https://en.wikipedia.org/wiki/Goodhart%27s_law)): aim for coverage and you get tests written to touch lines, not to catch mistakes. A test is worth its code when it pins down a rule, a parser, an edge case or an exception's reason. A smoke test (does it run at all?) only earns its place on a sensitive path that's hard to recover from, where a failure loses or damages the user's data: export and import, migrations, deleting all data, the database opening and the isolation reload. Elsewhere it adds maintenance without telling us anything the types and the other tests don't. Those smoke tests run in a real browser with Playwright ([`e2e/`](../../e2e/), `pnpm test:browser`), in CI next to the unit tests.

**Unit tests** run with Vitest (`pnpm test`), next to the code they test as `*.test.ts`. The repository functions take the Drizzle database as a parameter, so their tests pass a Node-backed instance (see [`docs/guidelines/database.md`](database.md)).

**Find elements the way users do**: by role and accessible name (`getByRole("button", { name: "Undo" })`), by label or by text, as Playwright recommends. That tests the semantics too. Use a `data-` attribute to check a variant, not to find an element.

**Every path gets a keyboard test.** Everything a pointer can do needs a keyboard way too (WCAG 2.1.1), and a test that only presses keys (Tab, the arrow keys, Enter, Space, Escape) and checks where focus lands (`toBeFocused()`) finds what's missing or out of order. Keep pointer tests where the pointer path is a different path: dragging a block, resizing from either edge, placing by tap on touch. Testing only with the keyboard would leave those untested.

**Browser tests** run with Playwright, in [`e2e/`](../../e2e/) (`pnpm test:browser` builds the app and runs them), for the paths where a failure would cost the user their plan, and for the automatic accessibility checks below. CI installs the matching Chromium. In a cloud container, use the preinstalled one: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm test:browser`. Add one when a new path could lose the user's data.

## Automatic accessibility checks

**Machines check what they can, at the earliest stage that can.** They find part of the problems, never all: they can't tell whether a name makes sense, whether the reading order tells the story, or whether the week works for someone who can't see it. The screen reader checks below, the keyboard by hand and asking users stay the main check.

- **Lint time:** oxlint's `jsx-a11y` rules check the markup in JSX: alt text, labels, valid roles and their required ARIA states, keyboard handlers next to click handlers.
- **Unit tests:** [`src/design-tokens.test.ts`](../../src/design-tokens.test.ts) measures the WCAG contrast of every text and surface pair the components use, in light and dark, and of the eight activity colors: 4.5:1 for text, 3:1 for swatches, bars and outlines. Add a pair there when a component puts a color on a new surface.
- **Browser tests:** [`e2e/accessibility.spec.ts`](../../e2e/accessibility.spec.ts) runs axe's WCAG 2.2 AA rules in both themes, and checks reflow at 320 CSS px, the WCAG text spacing and a focus ring at every Tab stop, with and without forced colors. It covers the placeholder page today; add each screen and state as it lands, opened the way a user gets there.
- **When the screens exist:** pin each screen's accessibility tree with Playwright's `toMatchAriaSnapshot`, so a lost name, a changed role or a heading out of order shows up as a diff in review.
- **Later:** [Guidepup](https://www.guidepup.dev/) drives VoiceOver on macOS and NVDA on Windows from Playwright, and GitHub's macOS and Windows runners can run it. Like the Orca setup below it's slow and timing-sensitive, so it belongs in a nightly or pre-release job, comparing what was said rather than asserting exact speech.

## Screen reader checks

**Check new or changed controls with a screen reader by hand.** The accessibility tree that Playwright's role queries read shows the roles and names, but not what a person hears, in which order, or whether a group is announced when focus enters and leaves it. These checks don't run in CI. Test on more than one screen reader where you can: NVDA on Windows, VoiceOver on macOS and iOS, TalkBack on Android. In a cloud container only Orca, the Linux screen reader, runs, and it can be scripted.

**Orca in a cloud container.** Orca runs against a headed Chromium on a virtual display, the keys come from Playwright, and Orca's debug log records every utterance as `SPEECH OUTPUT: '…'`.

1. Install it once per session: `apt-get install -y orca dbus-x11 at-spi2-core speech-dispatcher-espeak-ng`.
2. Send the audio nowhere. Without a sound device Orca blocks on its first utterance and logs nothing more:

   ```sh
   printf 'pcm.!default { type null }\n' > ~/.asoundrc
   mkdir -p ~/.config/speech-dispatcher
   printf 'AudioOutputMethod "alsa"\nAddModule "espeak-ng" "sd_espeak-ng" "espeak-ng.conf"\nDefaultModule espeak-ng\n' > ~/.config/speech-dispatcher/speechd.conf
   ```

3. Start a display, a session bus and the accessibility bus, and tell it a screen reader is on, so Chromium sends its events:

   ```sh
   export DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/xdg; mkdir -p -m 700 "$XDG_RUNTIME_DIR"
   Xvfb :99 -screen 0 1024x768x24 & sleep 1
   eval "$(dbus-launch --sh-syntax)"
   /usr/libexec/at-spi-bus-launcher --launch-immediately & sleep 1
   for property in IsEnabled ScreenReaderEnabled; do
     dbus-send --session --print-reply --dest=org.a11y.Bus /org/a11y/bus org.freedesktop.DBus.Properties.Set \
       string:org.a11y.Status "string:$property" variant:boolean:true >/dev/null
   done
   /usr/bin/python3.12 /usr/bin/orca --replace --debug-file=orca.log & sleep 8
   ```

   Orca needs the system Python, whose `gi` module it imports; the container's default `python3` is another one.

4. Drive the page from a Playwright script with `chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--force-renderer-accessibility"] })`. Wait about two seconds after each key so Orca has spoken, and log each key with a timestamp to line it up with the speech.
5. Read what was said: `grep 'SPEECH OUTPUT' orca.log`.

Keys sent with `xdotool` reach the window but not the page without a window manager, so let Playwright send them. Playwright's keys go to the page directly, past Orca, so this tests focus mode (Tab, the arrow keys on a control) and not Orca's browse mode or its own commands. Before a second run, stop every process from the first and empty `$XDG_RUNTIME_DIR`: Orca hangs at launch on the old accessibility bus sockets. Orca calls a `<fieldset>` a "panel", and it doesn't say an option's position ("1 of 3") unless that's turned on in its settings.

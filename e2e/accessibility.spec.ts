import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// The checks a machine can make on a rendered page (see Checking it in docs/spec/accessibility.md):
// axe's WCAG rules, reflow, text spacing and a visible focus ring at every Tab stop. They find part
// of the problems, not all: a screen reader and the keyboard by hand still decide (see Screen reader
// checks in docs/guidelines/tests.md). Each screen gets these once it exists.

/** WCAG 2.2 A and AA, the level the app aims for. */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function openApp(page: Page): Promise<void> {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
}

/** Every element that clips what overflows it horizontally or vertically, with how much it hides. */
function findClippedText(): string[] {
  const clipped: string[] = [];
  for (const element of document.body.querySelectorAll("*")) {
    const { overflowX, overflowY } = getComputedStyle(element);
    const isClippingX = overflowX === "hidden" || overflowX === "clip";
    const isClippingY = overflowY === "hidden" || overflowY === "clip";
    // the visually hidden text clips on purpose
    if (element.closest(".visually-hidden") !== null) continue;
    // So does a block's name, cut to the room left above its time (see docs/spec/grid-geometry.md).
    // The block's spoken name has it in full.
    if (element.matches(".block > .name")) continue;
    if (isClippingX && element.scrollWidth > element.clientWidth + 1) {
      clipped.push(
        `${element.tagName.toLowerCase()} hides ${element.scrollWidth - element.clientWidth}px across`,
      );
    }
    if (isClippingY && element.scrollHeight > element.clientHeight + 1) {
      clipped.push(
        `${element.tagName.toLowerCase()} hides ${element.scrollHeight - element.clientHeight}px down`,
      );
    }
  }
  return clipped;
}

/** Tabs through the page once, and says for each stop whether it shows a focus ring. */
async function collectTabStops(page: Page): Promise<{ name: string; isRingVisible: boolean }[]> {
  const stops: { name: string; isRingVisible: boolean }[] = [];
  for (let step = 0; step < 50; step++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const focused = document.activeElement;
      if (focused === null || focused === document.body) return null;
      const { outlineStyle, outlineWidth } = getComputedStyle(focused);
      const name = (focused.getAttribute("aria-label") ?? focused.textContent ?? "").trim();
      return {
        name,
        // The browser's own ring ("auto") is visible too. The app's is a 2px outline (see
        // Accessibility in docs/spec/design.md); computed widths are in px, as "2px".
        isRingVisible:
          outlineStyle === "auto" ||
          (outlineStyle !== "none" && Number(outlineWidth.replace("px", "")) >= 2),
      };
    });
    // back at the start, or out of the page
    if (stop === null || stops.some(({ name }) => name === stop.name)) break;
    stops.push(stop);
  }
  return stops;
}

/** axe's WCAG 2.2 AA findings on the page as it is: each rule and the elements it flagged. */
async function checkWithAxe(page: Page): Promise<string[]> {
  // axe measures contrast against the backgrounds it finds in the styles, and takes white where
  // there are none. The page's color comes from the color-scheme meta, which axe can't see, so this
  // states what the browser paints. The app's own backgrounds sit on top of it.
  await page.addStyleTag({ content: ":root { background: Canvas; }" });
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  // the page, the rule and the elements it flagged, so a failure says where to look
  const path = new URL(page.url()).pathname;
  return violations.map(
    ({ id, nodes }) => `${path} ${id}: ${nodes.map(({ target }) => target.join(" ")).join(", ")}`,
  );
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("passes axe's WCAG 2.2 AA rules on every page, on wide screens and phones", async ({
      page,
    }) => {
      await openApp(page);
      const results = [await checkWithAxe(page)];
      // Add block, open on the focused empty slot.
      await page.getByRole("button", { name: /^Empty slot/u }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("region", { name: /^Add block/u }).waitFor();
      results.push(await checkWithAxe(page));
      await page.keyboard.press("Escape");
      // A selected block, with its handles and remove button.
      await page.getByRole("button", { name: /^Gym, Monday/u }).focus();
      results.push(await checkWithAxe(page));
      // An activity's form, with an error showing, and the form for a new one.
      await page.getByRole("button", { name: "Edit Gym" }).click();
      await page.getByLabel("Hours", { exact: true }).fill("");
      await page.getByLabel("Hours", { exact: true }).press("Tab");
      results.push(await checkWithAxe(page));
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "New activity" }).click();
      results.push(await checkWithAxe(page));
      // Each page opened the way a user gets there.
      await page.getByRole("button", { name: "Expand navigation" }).click();
      for (const name of ["Activities", "Settings"]) {
        await page.getByRole("link", { name }).click();
        results.push(await checkWithAxe(page));
      }
      await page.setViewportSize({ width: 390, height: 760 });
      await page.getByRole("link", { name: "Week" }).click();
      results.push(await checkWithAxe(page));
      // Add block's bottom sheet.
      await page.getByRole("button", { name: /^Empty slot/u }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog", { name: "Add block" }).waitFor();
      results.push(await checkWithAxe(page));
      await page.keyboard.press("Escape");
      // The Activities page on a phone, and its empty state.
      await page.getByRole("link", { name: "Activities" }).click();
      results.push(await checkWithAxe(page));
      await page.getByRole("button", { name: "Start empty" }).click();
      results.push(await checkWithAxe(page));
      await page.goto(`${ISOLATED_URL}no-such-page`);
      await page.getByRole("heading", { name: "Page not found" }).waitFor();
      results.push(await checkWithAxe(page));
      expect(results.flat()).toEqual([]);
    });
  });
}

/** How far the page, or <main> inside it, reaches past the window's width: 0 when it reflows. */
const measureOverflow = (): number => {
  const main = document.querySelector("main");
  const page = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const inMain = main === null ? 0 : main.scrollWidth - main.clientWidth;
  return Math.max(0, page, inMain);
};

for (const textSize of ["100%", "200%"]) {
  test(`reflows at 320 CSS px with text at ${textSize}, without scrolling sideways (WCAG 1.4.10, 1.4.4)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const paths = ["", "activities", "settings"];
    const overflows: string[] = [];
    for (const path of paths) {
      await page.goto(`${ISOLATED_URL}${path}`);
      await expectStatus(page, "full");
      // Stands in for the user's text size; the app itself never sets a font size on the root.
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, textSize);
      overflows.push(`/${path}: ${String(await page.evaluate(measureOverflow))}px`);
    }
    expect(overflows).toEqual(paths.map((path) => `/${path}: 0px`));
  });
}

/** Each activity's name and how much wider its column is than the emblem's, in the Activities list. */
const measureNameRoom = (): string[] =>
  [...document.querySelectorAll(".activity-list > .activity")].map((row) => {
    const name = row.querySelector(".name")?.getBoundingClientRect().width ?? 0;
    const emblem = row.querySelector(".emblem")?.getBoundingClientRect().width ?? 0;
    return `${row.querySelector(".name")?.textContent ?? ""}: ${name > 3 * emblem ? "room" : `${String(Math.round(name))}px`}`;
  });

// Reflow alone passes when a column squeezes to a letter's width and its text wraps letter by
// letter: nothing scrolls sideways, but nothing can be read either. At 200% the narrowest row
// stacks its emblem and Edit above the name (see the activity list in docs/design/m3-tokens.css).
test("gives activity names room to wrap by word at 320 CSS px with text at 200%", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${ISOLATED_URL}activities`);
  await expectStatus(page, "full");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const rooms = await page.evaluate(measureNameRoom);
  expect(rooms).toHaveLength(5);
  expect(rooms.filter((room) => !room.endsWith(": room"))).toEqual([]);
  // Edit, in the top corner of the button that starts placing, still takes the click.
  await page.getByRole("button", { name: "Edit Gym" }).click();
  await expect(page.getByRole("button", { name: "Edit Gym" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

/** How far the window itself can scroll down: 0 when only the page's own regions scroll. */
const measureWindowScroll = (): number =>
  document.documentElement.scrollHeight - document.documentElement.clientHeight;

// Only <main>, the Activities pane and the week scroll (see the body rule in src/layout.css). An
// absolutely positioned element whose containing block is the window's, like visually hidden text
// in a region that isn't positioned, escapes that region's overflow and lets the window scroll too,
// over the app bar and the navigation into empty space. Short windows, so every page overflows.
for (const { device, width, height } of [
  { device: "wide screens", width: 1280, height: 500 },
  { device: "phones", width: 390, height: 600 },
]) {
  test(`scrolls only inside the page, never the window, on ${device}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const paths = ["", "activities", "settings", "no-such-page"];
    const scrolls: string[] = [];
    for (const path of paths) {
      await page.goto(`${ISOLATED_URL}${path}`);
      await expectStatus(page, "full");
      scrolls.push(`/${path}: ${String(await page.evaluate(measureWindowScroll))}px`);
    }
    expect(scrolls).toEqual(paths.map((path) => `/${path}: 0px`));
  });
}

test("keeps all text with the WCAG text spacing (WCAG 1.4.12)", async ({ page }) => {
  await openApp(page);
  // the spacing a user's style sheet may set, from the success criterion
  await page.addStyleTag({
    content: `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
      p { margin-block-end: 2em !important; }`,
  });
  expect(await page.evaluate(findClippedText)).toEqual([]);
});

for (const forcedColors of ["none", "active"] as const) {
  test(`shows a focus ring at every Tab stop (WCAG 2.4.7, forced colors ${forcedColors})`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors });
    await openApp(page);
    const stops = await collectTabStops(page);
    expect(stops.length).toBeGreaterThan(0);
    expect(
      stops
        .values()
        .filter(({ isRingVisible }) => !isRingVisible)
        .map(({ name }) => name)
        .toArray(),
    ).toEqual([]);
  });
}

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

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("passes axe's WCAG 2.2 AA rules on every page, on wide screens and phones", async ({
      page,
    }) => {
      await openApp(page);
      const results = [await checkWithAxe(page)];
      // Each page opened the way a user gets there.
      await page.getByRole("button", { name: "Expand navigation" }).click();
      for (const name of ["Activities", "Settings"]) {
        await page.getByRole("link", { name }).click();
        results.push(await checkWithAxe(page));
      }
      await page.setViewportSize({ width: 390, height: 760 });
      await page.getByRole("link", { name: "Week" }).click();
      results.push(await checkWithAxe(page));
      expect(results.flat()).toEqual([]);
    });
  });
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

test("reflows at 320 CSS px without scrolling sideways (WCAG 1.4.10)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApp(page);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

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

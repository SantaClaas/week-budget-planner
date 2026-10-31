import { expect, test, type Locator } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// The week, read-only (see docs/spec/grid-geometry.md and The week in docs/spec/accessibility.md),
// showing the example week a first run loads. British English, so the times read the same on every
// machine.
test.use({ locale: "en-GB" });

/** How far the week is scrolled down, and how tall a day is. */
async function measureScroll(week: Locator): Promise<{ scrollTop: number; height: number }> {
  const measured = await week.evaluate((element) => ({
    scrollTop: element.scrollTop,
    height: element.querySelector<HTMLElement>(".day-column")?.offsetHeight,
  }));
  if (measured.height === undefined) throw new Error("The week has no day column.");
  return { scrollTop: measured.scrollTop, height: measured.height };
}

/** How wide the week's region is, and how wide one day. */
async function measureWidths(week: Locator): Promise<{ week: number; day: number }> {
  const measured = await week.evaluate((element) => ({
    week: element.clientWidth,
    day: element.querySelector(".day")?.getBoundingClientRect().width,
  }));
  if (measured.day === undefined) throw new Error("The week has no day.");
  return { week: measured.week, day: measured.day };
}

test("shows the example week as days with headings and spelled-out blocks", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  const week = page.getByRole("region", { name: "Week" });
  const days = week.getByRole("list", { name: "Days" });
  await expect(days.locator("> li")).toHaveCount(7);
  await expect(
    week.getByRole("heading", { level: 2, name: "Monday, 3 hours placed" }),
  ).toBeVisible();
  await expect(
    week.getByRole("heading", { level: 2, name: "Friday, nothing placed" }),
  ).toBeVisible();
  await expect(
    week.getByText("Statistics lecture, Monday 10:00 to 11:30, 1 hour, 30 minutes"),
  ).toBeAttached();
  await expect(week.getByText("Gym, Monday 18:00 to 19:30, 1 hour, 30 minutes")).toBeAttached();
  // The times on the blocks are <time> elements, readable whatever the language.
  await expect(week.locator('time[datetime="PT1H30M"]').first()).toBeAttached();
});

test("opens at the day hours, and scrolls with the keyboard", async ({ page }) => {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  const week = page.getByRole("region", { name: "Week" });
  await expect(week.getByRole("heading", { name: /^Monday, /u })).toBeVisible();
  // A quarter hour above 07:00, so its label shows in full under the day headers.
  const opening = await measureScroll(week);
  expect(opening.scrollTop).toBeCloseTo((opening.height * 27) / 96, 0);
  await week.focus();
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => week.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(opening.scrollTop);
});

test("shows about three days on a phone, and snaps to a day when swiped", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
  const week = page.getByRole("region", { name: "Week" });
  const monday = week.getByRole("heading", { name: /^Monday, /u });
  await expect(monday).toBeVisible();
  const widths = await measureWidths(week);
  expect(widths.week / widths.day).toBeGreaterThan(3);
  expect(widths.week / widths.day).toBeLessThan(4.5);
  await week.evaluate((element) => {
    element.scrollBy({ left: 50 });
  });
  // The swipe settles on a day's start, not half way through one.
  await expect
    .poll(() => week.evaluate((element) => element.scrollLeft))
    .toBeCloseTo(widths.day, -1);
});

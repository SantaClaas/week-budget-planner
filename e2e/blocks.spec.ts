import { expect, test, type Locator, type Page } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// Editing blocks on the week: the keys, dragging and resizing with a pointer, removing, and
// selecting by touch (see Editing blocks in docs/spec/interactions.md and The week in
// docs/spec/accessibility.md). Each change is saved, so a reload keeps it. British English, so the
// times read the same on every machine.
test.use({ locale: "en-GB" });

async function openApp(page: Page): Promise<void> {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
}

/** What the shared live region says now. */
const readAnnouncement = (page: Page): Promise<string | null> =>
  page.locator("output").textContent();

/** The block button whose name starts with `name`. */
const findBlock = (page: Page, name: string): Locator =>
  page
    .getByRole("region", { name: "Week" })
    .getByRole("button", { name: new RegExp(`^${name}`, "u") });

/** Where a locator is on screen, which the test expects it to be. */
async function measure(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element isn't on screen.");
  return box;
}

/** The height of an hour on the week, in CSS pixels. */
const measureHour = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const column = document.querySelector<HTMLElement>(".day-column");
    if (column === null) throw new Error("The week has no day column.");
    return column.offsetHeight / 24;
  });

/**
 * Notes, right after the next key's own handlers ran, whether a View Transition runs on the week
 * and on the whole page, so a slow test machine can't miss one that's already over. Element-scoped
 * transitions aren't in TypeScript's DOM types yet, hence the `in` check.
 */
const watchNextKey = (page: Page): Promise<void> =>
  page.evaluate(() => {
    document.addEventListener(
      "keydown",
      () => {
        const week = document.querySelector(".week-scroller");
        const isWeek =
          week !== null && "activeViewTransition" in week && week.activeViewTransition !== null;
        document.body.dataset["transitions"] =
          `week ${String(isWeek)}, page ${String(document.activeViewTransition !== null)}`;
      },
      { once: true },
    );
  });

test("moves and resizes a block with the keys, says where it is, and keeps it", async ({
  page,
}) => {
  await openApp(page);
  const gym = findBlock(page, "Gym, Monday 18:00");
  await gym.focus();
  // A block takes focus in Tab order, and focus selects it.
  await expect(gym).toHaveAttribute("aria-pressed", "true");
  await expect(gym).toHaveAccessibleDescription(
    "Arrow keys move the block, Shift and the arrow keys change its length, Delete removes it.",
  );

  await page.keyboard.press("ArrowDown");
  await expect.poll(() => readAnnouncement(page)).toBe("Moved to Monday 18:15 to 19:45");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => readAnnouncement(page)).toBe("Moved to Tuesday 18:15 to 19:45");
  // Moving to another day draws the block in that day's list; focus stays on it.
  await expect(findBlock(page, "Gym, Tuesday 18:15 to 19:45")).toBeFocused();
  await page.keyboard.press("Shift+ArrowDown");
  await expect
    .poll(() => readAnnouncement(page))
    .toBe("Now Tuesday 18:15 to 20:00, 1 hour, 45 minutes");
  await page.keyboard.press("Escape");
  await expect(findBlock(page, "Gym, Tuesday")).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expectStatus(page, "full");
  await expect(findBlock(page, "Gym, Tuesday 18:15 to 20:00, 1 hour, 45 minutes")).toBeAttached();
});

test("animates a key move within the week, and a key pressed meanwhile builds on it", async ({
  page,
}) => {
  await openApp(page);
  await findBlock(page, "Gym, Monday 18:00").focus();
  await watchNextKey(page);
  await page.keyboard.press("ArrowRight");
  // Scoped to the week, so the rest of the page stays usable while the block moves.
  await expect(page.locator("body")).toHaveAttribute("data-transitions", "week true, page false");
  // Each key moves the block as the last one left it, even before that change shows.
  for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowDown");
  await expect.poll(() => readAnnouncement(page)).toBe("Moved to Tuesday 19:00 to 20:30");
  await expect(findBlock(page, "Gym, Tuesday 19:00 to 20:30")).toBeFocused();
});

test("moves a block across midnight into an overnight block with the keys", async ({ page }) => {
  await openApp(page);
  await findBlock(page, "Gym, Monday 18:00").focus();
  // Six hours longer, 15 minutes at a time: the end runs past midnight, from 19:30 to 01:30.
  for (let step = 0; step < 24; step++) await page.keyboard.press("Shift+ArrowDown");
  await expect
    .poll(() => readAnnouncement(page))
    .toBe("Now Monday 18:00 to Tuesday 01:30, 7 hours, 30 minutes");
  // The second part reads as taken on Tuesday morning.
  await expect(page.getByText("Gym, continued from Monday, until 01:30")).toBeAttached();
});

test("drags a block to another day and resizes it from both edges", async ({ page }) => {
  await openApp(page);
  const hour = await measureHour(page);
  const lecture = findBlock(page, "Statistics lecture, Monday 10:00");
  const box = await measure(lecture);

  // Held near its top, moved an hour down and a day to the right.
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + 20, { steps: 3 });
  await page.mouse.move(box.x + box.width * 1.5 + 8, box.y + 12 + hour, { steps: 6 });
  await page.mouse.up();
  const moved = findBlock(page, "Statistics lecture, Tuesday 11:00 to 12:30");
  await expect(moved).toBeVisible();
  await expect(moved).toBeFocused();

  // The bottom edge, half an hour down.
  let edge = await measure(moved);
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height - 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height - 2 + hour / 2, { steps: 4 });
  await page.mouse.up();
  await expect(findBlock(page, "Statistics lecture, Tuesday 11:00 to 13:00")).toBeVisible();

  // The top edge, an hour up, keeping the end.
  edge = await measure(findBlock(page, "Statistics lecture, Tuesday 11:00"));
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 2 - hour, { steps: 4 });
  await page.mouse.up();
  await expect(findBlock(page, "Statistics lecture, Tuesday 10:00 to 13:00")).toBeVisible();

  await page.reload();
  await expectStatus(page, "full");
  await expect(
    findBlock(page, "Statistics lecture, Tuesday 10:00 to 13:00, 3 hours"),
  ).toBeAttached();
});

test("removes a block with Delete and with its button, and Undo brings it back", async ({
  page,
}) => {
  await openApp(page);
  await findBlock(page, "Gym, Monday 18:00").focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => readAnnouncement(page)).toBe("Removed Gym, Monday 18:00 to 19:30");
  await expectStatus(page, "full", "5 activities · 7 blocks");
  // Focus moves on to a block that's still there.
  await expect(
    page.getByRole("region", { name: "Week" }).getByRole("button", { pressed: true }),
  ).toBeFocused();

  const lecture = findBlock(page, "Statistics lecture, Monday 10:00");
  await lecture.hover();
  await lecture.locator("xpath=..").getByRole("button", { name: "Remove block" }).click();
  await expectStatus(page, "full", "5 activities · 6 blocks");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expectStatus(page, "full");
});

test("deselects with Escape and with a click away from the blocks", async ({ page }) => {
  await openApp(page);
  const lecture = findBlock(page, "Statistics lecture, Monday 10:00");
  await lecture.click();
  await expect(lecture).toHaveAttribute("aria-pressed", "true");
  const box = await measure(lecture);
  // An empty slot below it, on the same day.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 40);
  await expect(lecture).toHaveAttribute("aria-pressed", "false");
});

test.describe("on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

  test("selects with the first tap, and only then drags", async ({ page }) => {
    await openApp(page);
    const lecture = findBlock(page, "Statistics lecture, Monday 10:00");
    let box = await measure(lecture);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 10);
    await expect(lecture).toHaveAttribute("aria-pressed", "true");

    const hour = await measureHour(page);
    box = await measure(lecture);
    const session = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + 10;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + (hour * step) / 8 }],
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(findBlock(page, "Statistics lecture, Monday 11:00 to 12:30")).toBeAttached();
  });
});

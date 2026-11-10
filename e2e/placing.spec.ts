import { expect, test, type Locator, type Page } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// Adding blocks by placing and by dragging an activity from the list (see Adding blocks in
// docs/spec/interactions.md). Each added block is saved, so a reload keeps it. British English, so
// the times read the same on every machine.
test.use({ locale: "en-GB" });

async function openApp(page: Page): Promise<void> {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
}

/** What the shared live region says now. */
const readAnnouncement = (page: Page): Promise<string | null> =>
  page.locator("output").textContent();

/** The activity's button in the list, which starts placing it. */
const findActivity = (page: Page, name: string): Locator =>
  page.getByRole("button", { name, exact: true });

/** Where a locator is on screen, which the test expects it to be. */
async function measure(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element isn't on screen.");
  return box;
}

/** The middle of a slot on the week: a day column's center at `hour` o'clock and a few minutes. */
async function findSlot(page: Page, day: number, hour: number): Promise<{ x: number; y: number }> {
  const column = await page.locator(".day-column").nth(day).boundingBox();
  if (column === null) throw new Error("The week has no such day column.");
  return { x: column.x + column.width / 2, y: column.y + (column.height / 24) * hour + 5 };
}

test("places an activity from the keyboard into the first free slot, and stops", async ({
  page,
}) => {
  await openApp(page);
  const gym = findActivity(page, "Gym");
  await expect(gym).toHaveAccessibleDescription(/1 hrs?, 30 mins? per day, 3 days/u);
  await gym.focus();
  await page.keyboard.press("Enter");
  await expect(gym).toHaveAttribute("aria-pressed", "true");
  const toolbar = page.getByRole("region", { name: /^Placing Gym/u });
  await expect(toolbar).toBeVisible();

  await toolbar.getByRole("button", { name: "Use first free slot" }).click();
  // Gym is counted per day, so a day without it comes first: Tuesday, at the start of the day hours.
  await expect.poll(() => readAnnouncement(page)).toBe("Added Gym, Tuesday 07:00 to 08:30");
  await expectStatus(page, "full", "5 activities · 9 blocks");

  await page.keyboard.press("Escape");
  await expect(toolbar).toBeHidden();
  await expect(gym).toHaveAttribute("aria-pressed", "false");
});

test("adds a block on the focused empty slot while placing, and focus moves on", async ({
  page,
}) => {
  await openApp(page);
  await findActivity(page, "Gym").click();
  const emptySlot = page.getByRole("button", { name: /^Empty slot/u });
  await emptySlot.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => readAnnouncement(page)).toBe("Added Gym, Monday 07:00 to 08:30");
  // The block covers the slot, so the empty slot moves on past it, and focus with it.
  await expect(emptySlot).toBeFocused();
  await expect(emptySlot).toHaveAccessibleName("Empty slot, Monday 08:30");
});

test("adds a block on each slot clicked while placing, until nothing is left", async ({ page }) => {
  await openApp(page);
  await findActivity(page, "Gym").click();
  const friday = await findSlot(page, 4, 10);
  // A mouse over an empty slot shows where the block would land.
  await page.mouse.move(friday.x, friday.y);
  await expect(page.locator(".block.preview")).toHaveText("10:00–11:30");
  await page.mouse.click(friday.x, friday.y);
  await expect.poll(() => readAnnouncement(page)).toBe("Added Gym, Friday 10:00 to 11:30");

  const saturday = await findSlot(page, 5, 9);
  await page.mouse.click(saturday.x, saturday.y);
  await expect.poll(() => readAnnouncement(page)).toBe("Added Gym, Saturday 09:00 to 10:30");
  // That's all three days: placing stops by itself.
  await expect(page.getByRole("region", { name: /^Placing Gym/u })).toBeHidden();

  await page.reload();
  await expectStatus(page, "full", "5 activities · 10 blocks");
  await expect(page.getByRole("button", { name: /^Gym, Saturday 09:00 to 10:30/u })).toBeAttached();
});

test("drags an activity from the list onto the week", async ({ page }) => {
  await openApp(page);
  const work = await measure(findActivity(page, "Work"));
  const target = await findSlot(page, 5, 9);
  await page.mouse.move(work.x + 20, work.y + 10);
  await page.mouse.down();
  await page.mouse.move(work.x + 40, work.y + 20, { steps: 3 });
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect(page.locator(".drag-chip")).toContainText("Work");
  await page.mouse.up();
  await expect.poll(() => readAnnouncement(page)).toBe("Added Work, Saturday 09:00 to 10:30");
  // A drag doesn't start placing.
  await expect(findActivity(page, "Work")).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expectStatus(page, "full", "5 activities · 9 blocks");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

  test("taps an activity to place it on the week, then taps a slot", async ({ page }) => {
    await page.goto(`${ISOLATED_URL}activities`);
    await expectStatus(page, "full");
    await findActivity(page, "Gym").tap();
    await expect(page).toHaveURL(ISOLATED_URL);
    const toolbar = page.getByRole("region", { name: /^Placing Gym/u });
    await expect(toolbar).toBeFocused();
    await expect(toolbar).toContainText("Tap a slot");

    const monday = await findSlot(page, 0, 12);
    await page.touchscreen.tap(monday.x, monday.y);
    await expect.poll(() => readAnnouncement(page)).toBe("Added Gym, Monday 12:00 to 13:30");
  });
});

import { expect, test, type Page } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// Add block from an empty slot (see Adding blocks in docs/spec/interactions.md and Add block in
// docs/spec/accessibility.md): the focused empty slot, the menu on wide screens and the bottom
// sheet on phones. Each added block is saved, so a reload keeps it. British English, so the times
// read the same on every machine.
test.use({ locale: "en-GB" });

async function openApp(page: Page): Promise<void> {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
}

/** The middle of a slot on the week: a day column's center at `hour` o'clock and a few minutes. */
async function findSlot(page: Page, day: number, hour: number): Promise<{ x: number; y: number }> {
  const column = await page.locator(".day-column").nth(day).boundingBox();
  if (column === null) throw new Error("The week has no such day column.");
  return { x: column.x + column.width / 2, y: column.y + (column.height / 24) * hour + 5 };
}

test("reaches an empty slot from the keyboard, moves it, and adds a block there", async ({
  page,
}) => {
  await openApp(page);
  // The empty slot comes after the last block in Tab order.
  await page.locator(".block-button").last().focus();
  await page.keyboard.press("Tab");
  const emptySlot = page.getByRole("button", { name: /^Empty slot/u });
  await expect(emptySlot).toBeFocused();
  await expect(emptySlot).toHaveAccessibleName("Empty slot, Monday 07:00");

  // Down a slot, an hour on, a day on: each move is a new button, with focus on it.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("PageDown");
  await page.keyboard.press("ArrowRight");
  await expect(emptySlot).toBeFocused();
  await expect(emptySlot).toHaveAccessibleName("Empty slot, Tuesday 08:15");

  await page.keyboard.press("Enter");
  const menu = page.getByRole("region", { name: "Add block · Tuesday 08:15" });
  await expect(menu).toBeVisible();
  await expect(emptySlot).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("button", { name: "Self-study" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(emptySlot).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "Work" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".snackbar")).toContainText("Added Work · Tue 08:15–09:45");
  await expect(page.getByRole("button", { name: /^Work, Tuesday 08:15 to 09:45/u })).toBeFocused();
  await expectStatus(page, "full", "5 activities · 9 blocks");

  // The snackbar's Undo takes it back.
  await page.locator(".snackbar").getByRole("button", { name: "Undo" }).click();
  await expectStatus(page, "full", "5 activities · 8 blocks");
});

test("adds a block from a click on an empty slot, and keeps it", async ({ page }) => {
  await openApp(page);
  const friday = await findSlot(page, 4, 14);
  await page.mouse.click(friday.x, friday.y);
  const menu = page.getByRole("region", { name: "Add block · Friday 14:00" });
  await expect(menu).toBeVisible();
  // Those with the most left come first, and an activity that's all placed comes last.
  await expect(menu.locator(".choice").last()).toHaveAccessibleDescription(
    "All placed · this would go over budget",
  );
  await menu.getByRole("button", { name: "Gym" }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".snackbar")).toContainText("Added Gym · Fri 14:00–15:30");

  await page.reload();
  await expectStatus(page, "full", "5 activities · 9 blocks");
  await expect(page.getByRole("button", { name: /^Gym, Friday 14:00 to 15:30/u })).toBeAttached();
});

test("adds a new activity from Add block, and its block", async ({ page }) => {
  await openApp(page);
  const friday = await findSlot(page, 4, 14);
  await page.mouse.click(friday.x, friday.y);
  await page.getByRole("button", { name: "New activity…" }).click();
  const form = page.getByRole("form", { name: "New activity" });
  await expect(form.getByLabel("Name")).toBeFocused();
  await form.getByLabel("Name").fill("Piano");
  await form.getByLabel("Hours").fill("2");
  await form.getByRole("button", { name: "Add activity" }).click();

  await expect(page.getByRole("button", { name: /^Piano, Friday 14:00 to 15:30/u })).toBeFocused();
  await expect(form).toBeHidden();
  await page.reload();
  await expectStatus(page, "full", "6 activities · 9 blocks");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

  test("adds a block from the bottom sheet, with its length set", async ({ page }) => {
    await openApp(page);
    const monday = await findSlot(page, 0, 12);
    await page.touchscreen.tap(monday.x, monday.y);
    const sheet = page.getByRole("dialog", { name: "Add block" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAccessibleDescription("Monday · from 12:00");
    await sheet.getByRole("button", { name: "15 minutes longer" }).tap();
    await sheet.getByRole("button", { name: "15 minutes longer" }).tap();
    await expect(sheet.locator("output")).toHaveText("2 hrs");
    await sheet.getByRole("button", { name: "Work" }).tap();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("button", { name: /^Work, Monday 12:00 to 14:00/u }),
    ).toBeAttached();

    await page.reload();
    await expectStatus(page, "full", "5 activities · 9 blocks");
  });

  test("adds a new activity from the sheet on the Activities page, then shows the week", async ({
    page,
  }) => {
    await openApp(page);
    const monday = await findSlot(page, 0, 12);
    await page.touchscreen.tap(monday.x, monday.y);
    await page.getByRole("button", { name: "New activity…" }).tap();
    await expect(page).toHaveURL(`${ISOLATED_URL}activities`);
    const form = page.getByRole("form", { name: "New activity" });
    await form.getByLabel("Name").fill("Piano");
    await form.getByLabel("Hours").fill("2");
    await form.getByRole("button", { name: "Add activity" }).tap();

    await expect(page).toHaveURL(ISOLATED_URL);
    await expect(
      page.getByRole("button", { name: /^Piano, Monday 12:00 to 13:30/u }),
    ).toBeFocused();
  });
});

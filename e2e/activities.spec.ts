import { expect, test, type Locator, type Page } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// The Activities list: adding, editing and deleting activities, and the example week's note (see
// Activities in docs/spec/interactions.md). Each change is saved, so a reload keeps it. American
// English, so the lengths read the same on every machine ("1 hr, 30 min").
test.use({ locale: "en-US" });

async function openApp(page: Page): Promise<void> {
  await page.goto(ISOLATED_URL);
  await expectStatus(page, "full");
}

test("adds an activity with the keyboard, and keeps it after a reload", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New activity" }).click();
  const form = page.getByRole("form", { name: "New activity" });
  await expect(form.getByLabel("Name")).toBeFocused();
  await page.keyboard.type("Yoga");
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Hours")).toBeFocused();
  await page.keyboard.type("1,5");
  await page.keyboard.press("Tab");
  await expect(form.getByRole("radio", { name: "per week" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(form.getByRole("radio", { name: "per day" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(form.getByLabel("Days")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");

  const list = page.getByRole("list").filter({ hasText: "Statistics lecture" });
  await expect(list.getByText("Yoga", { exact: true })).toBeVisible();
  await expect(list.getByText("1 hr, 30 min per day, 2 days")).toBeVisible();
  // The form opens again, empty, for the next activity.
  await expect(page.getByRole("form", { name: "New activity" }).getByLabel("Name")).toBeFocused();
  await expect(page.getByRole("form", { name: "New activity" }).getByLabel("Name")).toHaveValue("");
  await expectStatus(page, "full", "6 activities · 8 blocks");

  await page.reload();
  await expectStatus(page, "full", "6 activities · 8 blocks");
  await expect(page.getByText("1 hr, 30 min per day, 2 days")).toBeVisible();
});

test("says what's wrong with each field once the user is done with it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New activity" }).click();
  const form = page.getByRole("form", { name: "New activity" });
  const name = form.getByLabel("Name");
  const hours = form.getByLabel("Hours");
  // Nothing shows on an untouched form.
  await expect(name).not.toHaveAttribute("aria-invalid");

  await hours.fill("1.5h");
  await expect(hours).not.toHaveAttribute("aria-invalid");
  await hours.press("Tab");
  await expect(hours).toHaveAttribute("aria-invalid", "true");
  await expect(hours).toHaveAccessibleDescription("Enter the hours as a number, for example 1.5.");
  // The error clears as soon as the value is fixed.
  await hours.fill("200");
  await expect(hours).toHaveAccessibleDescription("A week has 168 hours. Enter 168 or less.");
  await hours.fill("2");
  await expect(hours).not.toHaveAttribute("aria-invalid");

  // Submitting marks every invalid field and takes focus to the first one.
  await form.getByRole("button", { name: "Add activity" }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Give the activity a name.");
  await expectStatus(page, "full");
});

test("edits an activity in its place, and Escape cancels", async ({ page }) => {
  await openApp(page);
  const editGym = page.getByRole("button", { name: "Edit Gym" });
  await expect(editGym).toHaveAttribute("aria-expanded", "false");
  await editGym.click();
  let form = page.getByRole("form", { name: "Edit Gym" });
  await expect(form.getByLabel("Name")).toBeFocused();
  // The form opens below the row, whose Edit button stays and says it's open.
  await expect(editGym).toHaveAttribute("aria-expanded", "true");
  await expect(form.getByLabel("Hours")).toHaveValue("1.5");
  await expect(form.getByRole("radio", { name: "per day" })).toBeChecked();
  await expect(form.getByRole("radio", { name: "Green" })).toBeChecked();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Climbing");
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(editGym).toBeFocused();
  await expect(editGym).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Enter");
  form = page.getByRole("form", { name: "Edit Gym" });
  await form.getByLabel("Name").fill("Climbing");
  await form.getByRole("radio", { name: "Teal" }).check();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Edit Climbing" })).toBeFocused();
  // Its blocks follow: the week shows the new name.
  await expect(
    page.getByRole("region", { name: "Week" }).getByText(/^Climbing, Monday 6:00 PM/u),
  ).toBeAttached();

  await page.reload();
  await expectStatus(page, "full");
  await expect(page.getByRole("button", { name: "Edit Climbing" })).toBeVisible();
});

test("deletes an activity with its blocks, and Undo brings them back", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Edit Work" }).click();
  await page
    .getByRole("form", { name: "Edit Work" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.locator(".snackbar")).toContainText("Deleted Work and its 2 blocks.");
  await expectStatus(page, "full", "4 activities · 6 blocks");
  // Focus moves on to the next activity.
  await expect(page.getByRole("button", { name: "Edit Gym" })).toBeFocused();

  await page.locator(".snackbar").getByRole("button", { name: "Undo" }).click();
  await expectStatus(page, "full");
  await expect(page.getByRole("button", { name: "Edit Work" })).toBeVisible();
});

test("starts empty, loads the example week again, and keeps it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Start empty" }).click();
  await expectStatus(page, "full", "0 activities · 0 blocks");
  await expect(page.locator(".snackbar")).toContainText("Example week removed.");
  // With nothing in the list, the form for a new activity is the next thing to do.
  await expect(page.getByRole("form", { name: "New activity" }).getByLabel("Name")).toBeFocused();
  // The pane keeps its name and heading, and the form's heading comes under it, a level down.
  const pane = page.getByRole("region", { name: "Activities" });
  await expect(pane.getByRole("heading", { level: 2, name: "Activities" })).toBeVisible();
  await expect(pane.getByRole("heading", { level: 3, name: "New activity" })).toBeVisible();

  await page.getByRole("button", { name: "Load an example week" }).click();
  await expectStatus(page, "full");
  await expect(page.getByRole("button", { name: "Keep these" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("This is an example week.")).toBeHidden();
  // The note goes with the focused button, so focus moves to the list's heading.
  await expect(pane.getByRole("heading", { name: "Activities" })).toBeFocused();

  await page.reload();
  await expectStatus(page, "full");
  await expect(page.getByText("This is an example week.")).toBeHidden();
});

test("saves per week after the days were cleared per day", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Edit Gym" }).click();
  const form = page.getByRole("form", { name: "Edit Gym" });
  await form.getByLabel("Days").fill("");
  await form.getByRole("radio", { name: "per week" }).check();
  // The days don't count per week, so their empty field doesn't stop the save.
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText("1 hr, 30 min per week")).toBeVisible();
});

test("opens the form on the Activities page from another page", async ({ page }) => {
  await page.goto(`${ISOLATED_URL}settings`);
  await expectStatus(page, "full");
  await page.getByRole("button", { name: "New activity" }).click();
  await expect(page).toHaveURL(`${ISOLATED_URL}activities`);
  await expect(page.getByRole("form", { name: "New activity" }).getByLabel("Name")).toBeFocused();
  await expect(page.getByRole("main")).toContainText(
    "14 hr, 30 min left to place across 5 activities",
  );
});

/** Where a locator is on screen, which the test expects it to be. */
async function measure(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element isn't on screen.");
  return box;
}

/** The activities' names, in the order the Activities list shows them. */
const readOrder = (page: Page): Promise<string[]> =>
  page
    .locator(".activity-list .activity .title-medium")
    .evaluateAll((names) => names.map((name) => name.textContent ?? ""));

test("reorders activities by dragging a handle, keeps the order, and Undo puts it back", async ({
  page,
  context,
}) => {
  await openApp(page);
  const before = ["Statistics lecture", "Linear algebra", "Self-study", "Work", "Gym"];
  const after = ["Gym", "Statistics lecture", "Linear algebra", "Self-study", "Work"];
  expect(await readOrder(page)).toEqual(before);
  // Gym's handle, dragged above the first row.
  const handle = await measure(page.getByRole("button", { name: "Reorder Gym" }));
  const first = await measure(page.locator(".activity-list .activity").first());
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, first.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator("output")).toHaveText("Gym moved to position 1 of 5");
  expect(await readOrder(page)).toEqual(after);

  // Another tab shows the new order, and a reload keeps it.
  const other = await context.newPage();
  await other.goto(ISOLATED_URL);
  await expectStatus(other, "full");
  await expect.poll(() => readOrder(other)).toEqual(after);

  // Undo puts the old order back, in both tabs and after a reload.
  await page.keyboard.press("Control+z");
  await expect.poll(() => readOrder(page)).toEqual(before);
  await expect.poll(() => readOrder(other)).toEqual(before);
  await page.reload();
  await expectStatus(page, "full");
  expect(await readOrder(page)).toEqual(before);
});

test("reorders an activity with the arrow keys on its handle, keeping focus there", async ({
  page,
}) => {
  await openApp(page);
  const handle = page.getByRole("button", { name: "Reorder Linear algebra" });
  await expect(handle).toHaveAccessibleDescription("Up and Down arrows move it.");
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("output")).toHaveText("Linear algebra moved to position 3 of 5");
  await expect(handle).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("output")).toHaveText("Linear algebra moved to position 1 of 5");
  await expect(handle).toBeFocused();
  // At the top, Up does nothing.
  await page.keyboard.press("ArrowUp");
  expect((await readOrder(page))[0]).toBe("Linear algebra");
  await page.reload();
  await expectStatus(page, "full");
  expect((await readOrder(page))[0]).toBe("Linear algebra");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 760 } });

  test("adds an activity from the Activities page", async ({ page }) => {
    await page.goto(`${ISOLATED_URL}activities`);
    await expectStatus(page, "full");
    await page.getByRole("button", { name: "New activity" }).click();
    const form = page.getByRole("form", { name: "New activity" });
    await form.getByLabel("Name").fill("Reading");
    await form.getByLabel("Hours").fill("3");
    await form.getByRole("button", { name: "Add activity" }).click();
    await expectStatus(page, "full", "6 activities · 8 blocks");
    await expect(page.getByRole("button", { name: "Edit Reading" })).toBeVisible();
  });
});

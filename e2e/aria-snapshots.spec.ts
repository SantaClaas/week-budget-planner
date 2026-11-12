import { expect, test, type Page } from "@playwright/test";

import { ISOLATED_URL, expectStatus } from "./app.ts";

// Each screen's accessibility tree, pinned (see Automatic accessibility checks in
// docs/guidelines/tests.md): what screen readers get, as Playwright's role queries read it. A lost
// name, a changed role or a heading out of order shows up as a diff in review. The text that
// changes from day to day or from build to build (today's date, the version's date and commit) is
// matched with a pattern.
test.use({ locale: "en-GB" });

async function openPage(page: Page, path = ""): Promise<void> {
  await page.goto(`${ISOLATED_URL}${path}`);
  await expectStatus(page, "full");
}

test("the Week page", async ({ page }) => {
  await openPage(page);
  await expect(page.getByRole("navigation", { name: "Sections" })).toMatchAriaSnapshot(`
    - navigation "Sections":
      - button "Expand navigation"
      - button "New activity"
      - link "Week":
        - /url: /week-budget-planner/
      - link "Activities":
        - /url: /week-budget-planner/activities
      - link "Settings":
        - /url: /week-budget-planner/settings
  `);
  await expect(page.getByRole("region", { name: "Activities" })).toMatchAriaSnapshot(`
    - region "Activities":
      - paragraph:
        - strong: This is an example week.
        - text: Change it, or start with an empty one.
      - button "Keep these"
      - button "Start empty"
      - heading "Activities" [level=2]
      - paragraph: /\\d+ hrs, \\d+ mins left to place/
      - list:
        - listitem:
          - button "Statistics lecture": Statistics lecture 3 hrs per week All placed 3 hrs
          - button "Edit Statistics lecture"
        - listitem:
          - button "Linear algebra": /Linear algebra 4 hrs, \\d+ mins per week 1 hr, \\d+ mins left to place/
          - button "Edit Linear algebra"
        - listitem:
          - button "Self-study": Self-study 8 hrs per week 6 hrs left to place
          - button "Edit Self-study"
        - listitem:
          - button "Work": /Work \\d+ hrs per week 4 hrs left to place/
          - button "Edit Work"
        - listitem:
          - button "Gym": /Gym 1 hr, \\d+ mins per day, 3 days 3 hrs left to place/
          - button "Edit Gym"
      - paragraph: Drag an activity onto the week, or click an empty slot to add a block there.
  `);
  await expect(page.getByRole("region", { name: "Week" })).toMatchAriaSnapshot(`
    - region "Week":
      - list "Days":
        - listitem:
          - heading "Monday, 3 hours placed" [level=2]
          - list:
            - listitem:
              - button /Statistics lecture, Monday \\d+:\\d+ to \\d+:\\d+, 1 hour, \\d+ minutes/
            - listitem:
              - button /Gym, Monday \\d+:\\d+ to \\d+:\\d+, 1 hour, \\d+ minutes/
        - listitem:
          - heading /Tuesday, 5 hours, \\d+ minutes placed/ [level=2]
          - list:
            - listitem:
              - button /Linear algebra, Tuesday \\d+:\\d+ to \\d+:\\d+, 1 hour, \\d+ minutes/
            - listitem:
              - button /Work, Tuesday \\d+:\\d+ to \\d+:\\d+, 4 hours/
        - listitem:
          - heading /Wednesday, 3 hours, \\d+ minutes placed/ [level=2]
          - list:
            - listitem:
              - button /Statistics lecture, Wednesday \\d+:\\d+ to \\d+:\\d+, 1 hour, \\d+ minutes/
            - listitem:
              - button /Self-study, Wednesday \\d+:\\d+ to \\d+:\\d+, 2 hours/
        - listitem:
          - heading /Thursday, 5 hours, \\d+ minutes placed/ [level=2]
          - list:
            - listitem:
              - button /Linear algebra, Thursday \\d+:\\d+ to \\d+:\\d+, 1 hour, \\d+ minutes/
            - listitem:
              - button /Work, Thursday \\d+:\\d+ to \\d+:\\d+, 4 hours/
        - listitem:
          - heading "Friday, nothing placed" [level=2]
          - list
        - listitem:
          - heading "Saturday, nothing placed" [level=2]
          - list
        - listitem:
          - heading "Sunday, nothing placed" [level=2]
          - list
      - button /Empty slot, Monday \\d+:\\d+/
  `);
});

test("placing, and Add block on an empty slot", async ({ page }) => {
  await openPage(page);
  await page.getByRole("button", { name: "Gym", exact: true }).click();
  await expect(page.getByRole("region", { name: /^Placing Gym/u })).toMatchAriaSnapshot(`
    - region /Placing Gym · 1 hr, \\d+ mins/:
      - paragraph: /Placing Gym · 1 hr, \\d+ mins Click a time slot · 3 hrs left to place/
      - button "Use first free slot"
      - button "Done"
  `);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Empty slot/u }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: /^Add block/u })).toMatchAriaSnapshot(`
    - region /Add block · Monday \\d+:\\d+/:
      - heading /Add block · Monday \\d+:\\d+/ [level=2]
      - list:
        - listitem:
          - button "Self-study": Self-study 6 hrs left
        - listitem:
          - button "Work": Work 4 hrs left
        - listitem:
          - button "Gym": /Gym 3 hrs left · usually 1 hr, \\d+ mins/
        - listitem:
          - button "Linear algebra": /Linear algebra 1 hr, \\d+ mins left/
        - listitem:
          - button "Statistics lecture": Statistics lecture All placed · this would go over budget
      - separator
      - button "New activity…"
  `);
});

test("the Activities page, with an activity's form open", async ({ page }) => {
  await openPage(page, "activities");
  await page.getByRole("button", { name: "Edit Gym" }).click();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Activities" [level=1]
      - link "Saved in this browser":
        - /url: /week-budget-planner/settings#your-data
      - button "Undo" [disabled]
      - paragraph:
        - strong: This is an example week.
        - text: Change it, or start with an empty one.
      - button "Keep these"
      - button "Start empty"
      - paragraph:
        - strong: /\\d+ hrs, \\d+ mins left to place/
        - text: across 5 activities
      - list:
        - listitem:
          - button "Statistics lecture": Statistics lecture 3 hrs per week All placed 3 hrs
          - button "Edit Statistics lecture"
        - listitem:
          - button "Linear algebra": /Linear algebra 4 hrs, \\d+ mins per week 1 hr, \\d+ mins left to place/
          - button "Edit Linear algebra"
        - listitem:
          - button "Self-study": Self-study 8 hrs per week 6 hrs left to place
          - button "Edit Self-study"
        - listitem:
          - button "Work": /Work \\d+ hrs per week 4 hrs left to place/
          - button "Edit Work"
        - listitem:
          - button "Gym": /Gym 1 hr, \\d+ mins per day, 3 days 3 hrs left to place/
          - button "Edit Gym" [expanded]
          - form "Edit Gym":
            - heading "Edit Gym" [level=2]
            - paragraph: /1 hr, \\d+ mins placed/
            - text: Name
            - textbox "Name": Gym
            - group "Budget":
              - text: Budget Hours
              - textbox "Hours": "1.5"
              - group "Counted":
                - text: ""
                - radio "per week"
                - text: per week
                - radio "per day" [checked]
                - text: per day
              - text: Days
              - textbox "Days": "3"
            - group "Color":
              - text: ""
              - radio "Blue"
              - text: Blue
              - radio "Red"
              - text: Red
              - radio "Green" [checked]
              - text: Green
              - radio "Amber"
              - text: Amber
              - radio "Violet"
              - text: Violet
              - radio "Teal"
              - text: Teal
              - radio "Pink"
              - text: Pink
              - radio "Lime"
              - text: Lime
            - group "Shape":
              - text: ""
              - radio "circle"
              - text: circle
              - radio "square"
              - text: square
              - radio "slanted"
              - text: slanted
              - radio "arch" [checked]
              - text: arch
              - radio "fan"
              - text: fan
              - radio "arrow"
              - text: arrow
              - radio "semi circle"
              - text: semi circle
              - radio "oval"
              - text: oval
              - radio "pill"
              - text: pill
              - radio "triangle"
              - text: triangle
              - radio "diamond"
              - text: diamond
              - radio "clam shell"
              - text: clam shell
              - radio "pentagon"
              - text: pentagon
              - radio "gem"
              - text: gem
              - radio "sunny"
              - text: sunny
              - radio "very sunny"
              - text: very sunny
              - radio "cookie 4"
              - text: cookie 4
              - radio "cookie 6"
              - text: cookie 6
              - radio "cookie 7"
              - text: cookie 7
              - radio "cookie 9"
              - text: cookie 9
              - radio /cookie \\d+/
              - text: /cookie \\d+/
              - radio "ghostish"
              - text: ghostish
              - radio "clover 4"
              - text: clover 4
              - radio "clover 8"
              - text: clover 8
              - radio "burst"
              - text: burst
              - radio "soft burst"
              - text: soft burst
              - radio "boom"
              - text: boom
              - radio "soft boom"
              - text: soft boom
              - radio "flower"
              - text: flower
              - radio "puffy"
              - text: puffy
              - radio "puffy diamond"
              - text: puffy diamond
              - radio "pixel circle"
              - text: pixel circle
              - radio "pixel triangle"
              - text: pixel triangle
              - radio "bun"
              - text: bun
              - radio "heart"
              - text: heart
            - button "Delete"
            - button "Cancel"
            - button "Save"
      - paragraph: Click an activity to place it, then click a slot on the week.
  `);
});

test("the Settings page", async ({ page }) => {
  await openPage(page, "settings");
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Settings" [level=1]
      - link "Saved in this browser":
        - /url: /week-budget-planner/settings#your-data
      - button "Undo" [disabled]
      - region "Appearance":
        - heading "Appearance" [level=2]
        - list:
          - listitem:
            - text: Theme
            - group "Theme":
              - radio "System" [checked]
              - text: System
              - radio "Light"
              - text: Light
              - radio "Dark"
              - text: Dark
            - paragraph: System is currently light.
          - listitem:
            - text: Contrast
            - group "Contrast":
              - radio "System" [checked]
              - text: System
              - radio "Less"
              - text: Less
              - radio "Standard"
              - text: Standard
              - radio "More"
              - text: More
            - paragraph: System is currently standard.
          - listitem:
            - text: Motion
            - group "Motion":
              - radio "System" [checked]
              - text: System
              - radio "Reduced"
              - text: Reduced
              - radio "Full"
              - text: Full
            - paragraph: System is currently full.
      - region "Your data":
        - heading "Your data" [level=2]
        - paragraph: Your plan is stored only in this browser. Nothing is uploaded. Export it to keep a backup or to move it to another device.
        - list:
          - listitem:
            - text: Keeping your plan This browser may delete your plan when it runs low on space. Export now and then to keep a copy.
            - button "Keep my plan"
          - listitem:
            - button "Export database": /Export database Saves week-budget-planner-\\d+-\\d+-\\d+\\.db/
          - listitem:
            - button "Import database": Import database Replaces the plan in this browser with an exported .db file, or a .json plan from a private window
          - listitem:
            - button "Delete all data": Delete all data Removes every activity and block from this browser
      - region "Storage":
        - heading "Storage" [level=2]
        - term: Activities
        - definition: "5"
        - term: Blocks
        - definition: "8"
        - term: Database size
        - definition: /\\d+ kB/
      - region "About":
        - heading "About" [level=2]
        - list:
          - listitem:
            - link /Version \\d+-\\d+-\\d+( · [0-9a-f]{7})? Built .+ Opens in a new tab/:
              - /url: /https:\\/\\/github\\.com\\/SantaClaas\\/week-budget-planner\\/tree\\/\\S+/
              - text: /Version \\d+-\\d+-\\d+( · [0-9a-f]{7})? Built/
              - time: /.+/
              - text: Opens in a new tab
  `);
});

test("a page that doesn't exist", async ({ page }) => {
  await page.goto(`${ISOLATED_URL}no-such-page`);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Page not found" [level=1]
      - link "Saved in this browser":
        - /url: /week-budget-planner/settings#your-data
      - button "Undo" [disabled]
      - paragraph: There's no page at this address.
      - link "Go to the week":
        - /url: /week-budget-planner/
  `);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true });

  test("the navigation bar, and Add block's bottom sheet", async ({ page }) => {
    await openPage(page);
    await expect(page.getByRole("navigation", { name: "Sections" })).toMatchAriaSnapshot(`
      - navigation "Sections":
        - link "Week":
          - /url: /week-budget-planner/
        - link "Activities":
          - /url: /week-budget-planner/activities
        - link "Settings":
          - /url: /week-budget-planner/settings
    `);
    await page.getByRole("button", { name: /^Empty slot/u }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Add block" })).toMatchAriaSnapshot(`
      - dialog "Add block":
        - heading "Add block" [level=2]
        - paragraph: /Monday · from \\d+:\\d+/
        - group "Length":
          - text: ""
          - button /\\d+ minutes shorter/
          - status: /1 hr, \\d+ mins/
          - button /\\d+ minutes longer/
        - list:
          - listitem:
            - button "Self-study": Self-study 6 hrs left
          - listitem:
            - button "Work": Work 4 hrs left
          - listitem:
            - button "Gym": /Gym 3 hrs left · usually 1 hr, \\d+ mins/
          - listitem:
            - button "Linear algebra": /Linear algebra 1 hr, \\d+ mins left/
          - listitem:
            - button "Statistics lecture": Statistics lecture All placed · this would go over budget
        - button "New activity…"
        - button "Cancel"
    `);
  });
});

/**
 * Regression: blocks must survive a rig switch. Reported symptom: a blocks
 * terminal shows its command cards (ls chips etc.), the user switches to
 * another rig and back, and the terminal body is completely empty — no
 * block containers, no headers, no chips — until a NEW command is typed.
 */
import { expect, MOD, test } from "./fixtures";
import { openBlocksTabAndRun } from "./helpers";

test("block cards survive switching rigs and back", async ({ page }) => {
  // Run `ls` in a fresh blocks tab; the seeded workspace has files, so the
  // files widget renders chips inside the block card.
  await openBlocksTabAndRun(page, "ls");
  await expect(page.locator(".tb-header").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".tb-chip").first()).toBeVisible({
    timeout: 20_000,
  });
  const chipsBefore = await page.locator(".tb-chip").count();
  expect(chipsBefore).toBeGreaterThan(0);

  // Create and switch to a fresh rig: the strip's plus button opens a
  // popover whose pinned "Local workspace" button actually creates it
  // (renamed from "New rig" in commit 4383e48).
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.getByRole("button", { name: /Local workspace/ }).click();
  await page.waitForTimeout(1_200);
  // The new rig is active: its fresh terminal shows, no block cards are
  // VISIBLE here (the first rig's cards persist in their parked, hidden
  // host — that survival is the point).
  await expect(page.locator(".term-block:visible")).toHaveCount(0);

  // Exhaust the renderer pool in the second rig with SPLIT PANES: splits
  // are all visible at once, so their slots stay bound (POOL_MAX_SIZE = 5).
  // Hidden tabs would merely rotate through retained slots; only bound
  // pressure evicts the parked blocks slot, serializing its buffer. The
  // return to the first rig then takes the reset + snapshot-replay rebind,
  // not the cheap retained fast path.
  await page.locator("body").click();
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press(`${MOD}+d`);
    await page.waitForTimeout(500);
  }

  // Back to the first rig by clicking its strip chip.
  await page.getByText("Default", { exact: true }).first().click();
  await page.waitForTimeout(1_200);

  // The block card and its content must be back WITHOUT typing anything.
  await expect(page.locator(".term-block").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".tb-header").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".tb-chip").first()).toBeVisible({
    timeout: 10_000,
  });
  expect(await page.locator(".tb-chip").count()).toBe(chipsBefore);
});

test("blocks survive a rig switch while output arrives in the background", async ({
  page,
}) => {
  // Reported bug: the terminal body comes back COMPLETELY empty after a
  // rig round-trip, healing only on the next command. Trigger: any PTY
  // write while the slot is parked (display:none) causes a render with a
  // zero-height viewport, which used to release every block container —
  // and unparking scheduled no render to rebuild them.
  await openBlocksTabAndRun(page, "ls");
  await expect(page.locator(".tb-chip").first()).toBeVisible({
    timeout: 20_000,
  });
  const chipsBefore = await page.locator(".tb-chip").count();

  // Start a command whose output lands AFTER we switch away, then switch
  // immediately: the late output renders into the parked (display:none) slot.
  await page.keyboard.type("sleep 1.5; echo late");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.getByRole("button", { name: /Local workspace/ }).click();
  await page.waitForTimeout(2_500);

  // Back to the first rig via its strip chip.
  await page.getByText("Default", { exact: true }).first().click();
  await page.waitForTimeout(1_200);

  // The old blocks must still be there — no new input.
  await expect(page.locator(".term-block").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".tb-header").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".tb-chip").first()).toBeVisible({
    timeout: 10_000,
  });
  expect(await page.locator(".tb-chip").count()).toBe(chipsBefore);
});

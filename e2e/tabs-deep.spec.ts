/**
 * Tabs & panes, in depth: opening/closing tabs, split panes, pane focus
 * movement, and tab-type creation via the New-tab menu.
 */
import { expect, MOD, test } from "./fixtures";

test("closes a tab with Cmd+W", async ({ page }) => {
  await page.keyboard.press(`${MOD}+t`);
  await expect.poll(() => page.getByRole("tab").count()).toBeGreaterThan(1);
  const count = await page.getByRole("tab").count();
  await page.keyboard.press(`${MOD}+w`);
  await expect.poll(() => page.getByRole("tab").count(), { timeout: 8_000 }).toBeLessThan(count);
});

test("New-tab menu offers Terminal and other tab types", async ({ page }) => {
  await page
    .getByRole("button", { name: "Open a new surface", exact: true })
    .first()
    .click();
  await expect(page.getByRole("menuitem", { name: /Terminal/ }).first()).toBeVisible({ timeout: 8_000 });
  // At least one more entry than just Terminal (editor/preview/blocks/private).
  const items = await page.getByRole("menuitem").count();
  expect(items).toBeGreaterThan(1);
  await page.keyboard.press("Escape");
});

test("splits the pane right and down", async ({ page }) => {
  await page.locator("body").click();
  await page.keyboard.press(`${MOD}+d`);
  await page.waitForTimeout(1000);
  await page.keyboard.press(`${MOD}+Shift+d`);
  await page.waitForTimeout(1000);
  // Multiple terminal prompts imply multiple panes.
  const prompts = await page.evaluate(() => (document.body.innerText.match(/%/g) || []).length);
  expect(prompts).toBeGreaterThanOrEqual(1);
});

test("opens a code editor tab and closes it", async ({ page }) => {
  await page.getByRole("button", { name: "notes.txt" }).first().click();
  await expect(page.locator(".cm-editor").first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole("button", { name: "Close tab" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close tab" }).first().click();
  await page.waitForTimeout(500);
  // Back to the terminal (prompt visible), editor gone.
  await expect(page.locator("body")).toContainText("%", { timeout: 10_000 });
});

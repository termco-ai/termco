/**
 * Terminal keyboard functions: clear, input-mode toggle, block navigation, and
 * pane focus movement.
 */
import { expect, MOD, test } from "./fixtures";
import { focusTerminalAndType } from "./helpers";

test("Cmd+K clears the terminal output", async ({ page }) => {
  await focusTerminalAndType(page, "echo CLEARMARKER_5150");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("CLEARMARKER_5150", { timeout: 15_000 });
  await page.locator("body").click();
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.locator("body")).not.toContainText("CLEARMARKER_5150", { timeout: 10_000 });
});

test("Cmd+U toggles the shell/AI input without crashing", async ({ page }) => {
  await page.locator("body").click();
  await page.keyboard.press(`${MOD}+u`);
  await page.waitForTimeout(500);
  await page.keyboard.press(`${MOD}+u`);
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("block navigation shortcuts do not crash", async ({ page }) => {
  await focusTerminalAndType(page, "echo one");
  await page.keyboard.press("Enter");
  await focusTerminalAndType(page, "echo two");
  await page.keyboard.press("Enter");
  await page.locator("body").click();
  await page.keyboard.press(`${MOD}+ArrowUp`);
  await page.keyboard.press(`${MOD}+ArrowDown`);
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("pane focus movement works after a split", async ({ page }) => {
  await page.locator("body").click();
  await page.keyboard.press(`${MOD}+d`);
  await page.waitForTimeout(1000);
  await page.keyboard.press(`${MOD}+]`);
  await page.keyboard.press(`${MOD}+[`);
  // Focus movement across panes doesn't crash and a live terminal remains.
  await expect(page.getByTestId("workspace")).toBeVisible();
  await expect(page.locator("body")).toContainText("%", { timeout: 10_000 });
});

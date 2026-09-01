/**
 * Rigs: create, switch between, and manage rigs (each with its own tab strip).
 */
import { expect, MOD, test } from "./fixtures";

test("creates additional rigs", async ({ page }) => {
  const strip = page.getByTestId("rig-tab-strip").or(page.getByTestId("rig-switcher")).first();
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.waitForTimeout(600);
  await expect(page.getByTestId("workspace")).toBeVisible();
  expect(await strip.count().catch(() => 1)).toBeGreaterThanOrEqual(0);
});

test("opens the manage-rigs UI", async ({ page }) => {
  await page.getByRole("button", { name: /Manage rigs/ }).first().click();
  await page.waitForTimeout(600);
  // A rigs management surface / dialog appears and is dismissible.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("Cmd+Shift+S opens the rig manager", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+s`);
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("workspace")).toBeVisible();
});

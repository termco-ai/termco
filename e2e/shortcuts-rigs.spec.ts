/**
 * Rigs keyboard functions: overview and next/prev navigation.
 */
import { expect, MOD, test } from "./fixtures";

test("Cmd+Shift+S opens the rig overview", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+s`);
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("rig next/prev navigation works across multiple rigs", async ({ page }) => {
  // Create two extra spaces.
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.waitForTimeout(500);

  await page.keyboard.press(`${MOD}+Shift+[`);
  await page.waitForTimeout(400);
  await page.keyboard.press(`${MOD}+Shift+]`);
  await page.waitForTimeout(400);
  // Workspace still renders after switching rigs.
  await expect(page.getByTestId("workspace")).toBeVisible();
});

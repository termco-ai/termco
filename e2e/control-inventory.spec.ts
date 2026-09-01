/**
 * Control inventory + interaction crawl: the "every button" coverage. Rather than
 * blindly clicking destructive controls, this enumerates every visible
 * interactive control in each major UI state and asserts breadth + that virtually
 * none are truly unlabeled (an unlabeled, icon-less button is a regression), then
 * crawls across all panels asserting zero unexpected console errors.
 */
import { collectErrors, expect, MOD, openSettingsWindow, test } from "./fixtures";
import { inventoryControls, openAiPanel, openSourceControl } from "./helpers";

async function assertInventory(page: import("@playwright/test").Page, min: number) {
  const { total, unlabeled } = await inventoryControls(page);
  expect(total, "too few interactive controls — a panel likely failed to render").toBeGreaterThan(min);
  expect(unlabeled, `unlabeled controls:\n${unlabeled.join("\n")}`).toEqual([]);
}

test("initial state exposes many labeled controls", async ({ page }) => {
  await assertInventory(page, 15);
});

test("AI panel exposes labeled controls", async ({ page }) => {
  await openAiPanel(page);
  await assertInventory(page, 15);
});

test("source control exposes labeled controls", async ({ page }) => {
  await openSourceControl(page);
  await assertInventory(page, 15);
});

test("settings window exposes labeled controls", async ({ app, page }) => {
  const settings = await openSettingsWindow(app, page);
  await settings.waitForTimeout(1000);
  await assertInventory(settings, 5);
});

test("crawling every panel produces no unexpected console errors", async ({ app, page }) => {
  const { errors } = collectErrors(page);

  await page.keyboard.press(`${MOD}+p`); // palette
  await page.keyboard.press("Escape");

  await openAiPanel(page);
  await page.keyboard.press(`${MOD}+i`); // close AI

  await openSourceControl(page);
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "Files" }).first().click();
  await page.getByRole("button", { name: "notes.txt" }).first().click();
  await page.waitForTimeout(500);

  await page.keyboard.press(`${MOD}+t`); // new terminal tab
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.waitForTimeout(500);

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
});

test("crawling every settings tab produces no unexpected console errors", async ({ app, page }) => {
  const settings = await openSettingsWindow(app, page);
  const { errors } = collectErrors(settings);
  for (const tab of ["Appearance", "Shortcuts", "Models", "About", "General"]) {
    await settings.getByRole("tab", { name: tab }).or(settings.getByRole("button", { name: tab })).first().click();
    await settings.waitForTimeout(300);
  }
  expect(errors, `unexpected settings console errors:\n${errors.join("\n")}`).toEqual([]);
});

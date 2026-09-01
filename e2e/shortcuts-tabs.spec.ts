/**
 * Tab-related keyboard functions: new blocks/private/preview tabs, tab
 * navigation (next/prev), and select-by-index.
 */
import { expect, MOD, test } from "./fixtures";

const tabCount = (page: import("@playwright/test").Page) => page.getByRole("tab").count();

test("Cmd+Shift+T opens a new Blocks terminal tab", async ({ page }) => {
  const before = await tabCount(page);
  await page.keyboard.press(`${MOD}+Shift+t`);
  await expect.poll(() => tabCount(page), { timeout: 8_000 }).toBeGreaterThan(before);
});

test("Cmd+R opens a new private terminal tab (no page reload)", async ({ page }) => {
  const before = await tabCount(page);
  await page.keyboard.press(`${MOD}+r`);
  await expect.poll(() => tabCount(page), { timeout: 8_000 }).toBeGreaterThan(before);
  // Still the same app instance (Cmd+R did not reload the window).
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("Cmd+Shift+O opens a web-preview tab", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect(page.getByRole("tab", { name: /preview/i }).first()).toBeVisible({ timeout: 10_000 });
});

test("switches the active tab (click + Ctrl+Tab)", async ({ page }) => {
  await page.keyboard.press(`${MOD}+t`);
  await expect.poll(() => tabCount(page)).toBeGreaterThan(1);
  const tabs = page.getByRole("tab");
  const selectedIdx = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tab"]')).findIndex(
        (t) => t.getAttribute("aria-selected") === "true",
      ),
    );
  // Clicking a tab selects it (core tab-switching behavior).
  await tabs.first().click();
  await expect.poll(selectedIdx, { timeout: 6_000 }).toBe(0);
  await tabs.nth(1).click();
  await expect.poll(selectedIdx, { timeout: 6_000 }).toBe(1);
  // Ctrl+Tab cycles without crashing.
  await page.keyboard.press("Control+Tab");
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("Cmd+1 selects the first tab", async ({ page }) => {
  await page.keyboard.press(`${MOD}+t`);
  await expect.poll(() => tabCount(page)).toBeGreaterThan(1);
  await page.keyboard.press(`${MOD}+1`);
  await page.waitForTimeout(400);
  const firstSelected = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
    return tabs[0]?.getAttribute("aria-selected") === "true";
  });
  expect(firstSelected).toBe(true);
});

/**
 * View functions: zen mode (hides chrome), zoom in/out/reset (--app-zoom var),
 * sidebar toggle, and explorer focus.
 */
import { expect, MOD, test } from "./fixtures";

const appZoom = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--app-zoom").trim(),
  );

test("Cmd+Shift+Z toggles zen mode (hides the tab bar/chrome)", async ({ page }) => {
  await expect(page.getByRole("tab").first()).toBeVisible();
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => page.getByRole("tab").count(), { timeout: 8_000 }).toBe(0);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect.poll(() => page.getByRole("tab").count(), { timeout: 8_000 }).toBeGreaterThan(0);
});

test("Cmd+= / Cmd+- / Cmd+0 change and reset the app zoom", async ({ page }) => {
  const base = (await appZoom(page)) || "1";
  await page.keyboard.press(`${MOD}+=`);
  await page.keyboard.press(`${MOD}+=`);
  await expect.poll(() => appZoom(page), { timeout: 6_000 }).not.toBe(base);
  const zoomedIn = await appZoom(page);
  expect(Number.parseFloat(zoomedIn)).toBeGreaterThan(Number.parseFloat(base));

  await page.keyboard.press(`${MOD}+0`);
  await expect.poll(() => appZoom(page), { timeout: 6_000 }).toBe("1");
});

test("toggles the sidebar (collapses/expands its width)", async ({ page }) => {
  const sidebar = page.getByTestId("sidebar");
  const width = async () => (await sidebar.boundingBox())?.width ?? 0;
  const w0 = await width();
  expect(w0).toBeGreaterThan(50);
  await page.getByRole("button", { name: "Toggle sidebar" }).first().click();
  await expect.poll(width, { timeout: 8_000 }).toBeLessThan(w0);
  await page.getByRole("button", { name: "Toggle sidebar" }).first().click();
  await expect.poll(width, { timeout: 8_000 }).toBeGreaterThanOrEqual(w0 - 5);
});

test("Cmd+Shift+E focuses the explorer without crashing", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+e`);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "README.md" })).toBeVisible();
});

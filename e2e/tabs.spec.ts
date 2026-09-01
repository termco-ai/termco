/**
 * Tabs & rigs: new terminal/editor tabs and rigs can be created and the app
 * stays responsive. (The "New tab" header button opens a type menu; Cmd/Ctrl+T
 * creates a terminal tab directly.)
 */
import { expect, MOD, test } from "./fixtures";

test("Cmd+T opens a new terminal tab", async ({ page }) => {
  const before = await page.getByRole("tab").count();
  await page.keyboard.press(`${MOD}+t`);
  await expect.poll(() => page.getByRole("tab").count(), { timeout: 8_000 }).toBeGreaterThan(before);
});

test("the new surface button opens a type menu with Terminal", async ({ page }) => {
  await page
    .getByRole("button", { name: "Open a new surface", exact: true })
    .first()
    .click();
  await expect(page.getByRole("menuitem", { name: /Terminal/ }).first())
    .toBeVisible({ timeout: 8_000 });
  await page.keyboard.press("Escape");
});

test("Cmd+E creates a new editor tab via the New file dialog", async ({ page }) => {
  await page.keyboard.press(`${MOD}+e`);
  const dialog = page.getByRole("dialog", { name: /New workspace file/ });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("textbox").first().fill("scratch.ts");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-editor").first()).toBeVisible({ timeout: 12_000 });
});

test("creates a new rig", async ({ app, page }) => {
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.waitForTimeout(800);
  expect(app.windows().length).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("workspace")).toBeVisible();
});

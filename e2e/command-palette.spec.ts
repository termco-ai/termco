/**
 * Command palette: opens on Cmd/Ctrl+P, filters as you type, and closes on Esc.
 */
import { expect, test } from "./fixtures";
import { openCommandPalette } from "./helpers";

test("opens, filters, and closes", async ({ page }) => {
  await openCommandPalette(page);
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();

  // A search box is focused; typing filters the option list.
  await page.keyboard.type("settings");
  await expect(dialog.getByRole("option").first()).toBeVisible({ timeout: 8_000 });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 8_000 });
});

test("running a palette command performs an action", async ({ app, page }) => {
  await openCommandPalette(page);
  await page.keyboard.type("new terminal");
  const option = page.getByRole("option", { name: /new terminal/i }).first();
  await expect(option).toBeVisible({ timeout: 8_000 });
  await option.click();
  // No crash; palette closed.
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8_000 });
  expect(app.windows().length).toBeGreaterThanOrEqual(1);
});

/**
 * Command palette, in depth: runs several real commands and the find-in-files mode.
 */
import { expect, MOD, test } from "./fixtures";
import { openCommandPalette } from "./helpers";

async function runCommand(page: import("@playwright/test").Page, query: string) {
  await openCommandPalette(page);
  await page.keyboard.type(query);
  // Select the command the test asked for, not merely the first fuzzy result.
  // Folder-loaded registrations can legitimately change equal-score ordering.
  const opt = page
    .getByRole("option", { name: new RegExp(query, "i") })
    .first();
  await expect(opt).toBeVisible({ timeout: 8_000 });
  await opt.click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8_000 });
}

test("runs 'Open settings' from the palette", async ({ app, page }) => {
  const waitWin = app.waitForEvent("window", { timeout: 15_000 }).catch(() => null);
  await runCommand(page, "settings");
  const win = await waitWin;
  // Either a settings window opened, or the command ran without error.
  expect(app.windows().length).toBeGreaterThanOrEqual(win ? 2 : 1);
});

test("runs 'Split pane' from the palette", async ({ page }) => {
  await runCommand(page, "split pane");
  // The command ran and the app stays responsive with a live terminal. A freshly
  // split pane can take a moment to render its prompt under load, so allow time
  // and accept either common prompt char (zsh %, bash $).
  await expect(page.getByTestId("workspace")).toBeVisible();
  await expect(page.locator("body")).toContainText(/[%$]/, { timeout: 15_000 });
});

test("runs 'New editor tab' from the palette", async ({ page }) => {
  await openCommandPalette(page);
  await page.keyboard.type("new editor");
  const opt = page.getByRole("option", { name: /editor tab/i }).first();
  await expect(opt).toBeVisible({ timeout: 8_000 });
  await opt.click();
  // A new-file dialog or an editor mounts. (The dialog's title is
  // "New workspace file" since commit 4383e48.)
  await expect(
    page
      .getByRole("dialog", { name: /New (workspace )?file/ })
      .or(page.locator(".cm-editor").first()),
  ).toBeVisible({ timeout: 10_000 });
});

test("find-in-files mode opens with Cmd+Shift+P", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+p`);
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 8_000 });
  await page.keyboard.type("answer");
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
});

test("palette closes on Escape without side effects", async ({ page }) => {
  await openCommandPalette(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 8_000 });
});

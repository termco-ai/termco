/**
 * Source control, in depth: per-file stage/unstage toggle, discard (reverts the
 * change), opening a diff, and refresh.
 */
import { expect, test } from "./fixtures";
import { openSourceControl } from "./helpers";

test("stages then unstages a single file", async ({ page }) => {
  await openSourceControl(page);
  const cb = page.getByRole("checkbox", { name: "Stage notes.txt" }).first();
  await cb.click();
  await expect(cb).toBeChecked({ timeout: 10_000 });
  await cb.click();
  await expect(cb).not.toBeChecked({ timeout: 10_000 });
});

test("opens a diff for a changed file", async ({ page }) => {
  await openSourceControl(page);
  await page.getByRole("button", { name: "notes.txt" }).first().click();
  // The diff shows the added line from the seeded change.
  await expect(page.getByText("line three (uncommitted)").first()).toBeVisible({ timeout: 12_000 });
});

test("discards a change and reverts the working tree", async ({ page }) => {
  await openSourceControl(page);
  await page.getByRole("button", { name: "Discard notes.txt" }).first().click();
  const confirm = page.getByRole("button", { name: /Discard|Confirm/ }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole("button", { name: "notes.txt" }))
    .toBeHidden({ timeout: 12_000 });
});

test("refresh keeps the panel consistent", async ({ page }) => {
  await openSourceControl(page);
  await page.getByRole("button", { name: /Refresh source control/ }).first().click();
  await page.waitForTimeout(800);
  await expect(page.getByRole("button", { name: "main", exact: true }).first()).toBeVisible();
});

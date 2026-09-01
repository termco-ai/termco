/**
 * Git history, in depth: the commit graph lists commits and a commit's details
 * (its file changes) can be inspected.
 */
import { expect, test } from "./fixtures";
import { openSourceControl } from "./helpers";

test("commit graph lists the initial commit", async ({ page }) => {
  await openSourceControl(page);
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await expect(page.getByText("initial commit").first()).toBeVisible({ timeout: 15_000 });
});

test("selecting a commit reveals its details", async ({ page }) => {
  await openSourceControl(page);
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await page.getByText("initial commit").first().click();
  await page.waitForTimeout(1000);
  // The commit detail surfaces the author, a changed file, or a files-changed count.
  await expect(
    page.getByText(/Termco E2E|README\.md|index\.ts|notes\.txt|files? changed|\d+ files?/i).first(),
  ).toBeVisible({ timeout: 12_000 });
});

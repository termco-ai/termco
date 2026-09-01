/**
 * Git history: the commit graph opens and shows the repo's commits.
 */
import { expect, test } from "./fixtures";
import { openSourceControl } from "./helpers";

test("commit graph shows the repo history", async ({ page }) => {
  await openSourceControl(page);
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await expect(page.getByText("initial commit").first()).toBeVisible({ timeout: 15_000 });
});

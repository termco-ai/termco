/**
 * Workspace context: the app surfaces the working directory and the git branch
 * for the repo workspace (verified end-to-end through the live shell).
 */
import { expect, test } from "./fixtures";
import { focusTerminalAndType } from "./helpers";

test("the workspace cwd is the seeded directory", async ({ page }) => {
  await focusTerminalAndType(page, "pwd");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText(/termco-e2e-ws-/, { timeout: 15_000 });
});

test("the workspace git branch is surfaced", async ({ page }) => {
  await focusTerminalAndType(page, "git branch --show-current");
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toContainText("main", { timeout: 15_000 });
});

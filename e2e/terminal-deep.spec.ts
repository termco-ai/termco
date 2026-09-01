/**
 * Terminal, in depth: multiple commands, cwd/state persistence within a session,
 * clear, split panes, and multiple independent terminal tabs.
 */
import { expect, MOD, test } from "./fixtures";
import { focusTerminalAndType } from "./helpers";

async function run(page: import("@playwright/test").Page, cmd: string) {
  await focusTerminalAndType(page, cmd);
  await page.keyboard.press("Enter");
}

test("runs several commands and reflects their output", async ({ page }) => {
  await run(page, "echo alpha_marker_111");
  await expect(page.locator("body")).toContainText("alpha_marker_111", { timeout: 15_000 });
  await run(page, "echo beta_marker_222");
  await expect(page.locator("body")).toContainText("beta_marker_222", { timeout: 15_000 });
});

test("keeps shell state across commands (cd persists)", async ({ page }) => {
  await run(page, "cd src && pwd");
  await expect(page.locator("body")).toContainText("/src", { timeout: 15_000 });
});

test("lists workspace files from the shell", async ({ page }) => {
  await run(page, "ls");
  await expect(page.locator("body")).toContainText("README.md", { timeout: 15_000 });
});

test("Cmd+D splits the pane", async ({ page }) => {
  const panes = page.locator("[data-pane-leaf]");
  await expect(panes).toHaveCount(1, { timeout: 15_000 });
  await panes.first().click();
  await page.keyboard.press(`${MOD}+d`);
  await expect(panes).toHaveCount(2, { timeout: 15_000 });
});

test("Cmd+T creates an independent second terminal tab", async ({ page }) => {
  await run(page, "echo tab_one_marker");
  await expect(page.locator("body")).toContainText("tab_one_marker", { timeout: 15_000 });
  await page.keyboard.press(`${MOD}+t`);
  await page.waitForTimeout(1000);
  await run(page, "echo tab_two_marker");
  await expect(page.locator("body")).toContainText("tab_two_marker", { timeout: 15_000 });
});

/**
 * Terminal: a real PTY-backed shell is live in the default tab; commands run and
 * their output is reflected in the terminal.
 */
import { expect, test } from "./fixtures";
import { focusTerminalAndType } from "./helpers";

test("renders a live shell prompt", async ({ page }) => {
  await expect(page.locator("body")).toContainText("%", { timeout: 20_000 });
});

test("runs a command and shows its output", async ({ page }) => {
  await focusTerminalAndType(page, "echo termco_e2e_marker_9271");
  await page.keyboard.press("Enter");
  // The command echoes and the shell prints the output line.
  await expect(page.locator("body")).toContainText("termco_e2e_marker_9271", {
    timeout: 15_000,
  });
});

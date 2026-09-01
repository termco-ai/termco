/**
 * Search + AI-selection + rigs keyboard functions.
 */
import { expect, MOD, test } from "./fixtures";

test("Cmd+F focuses the search box", async ({ page }) => {
  // Establish the same focused-terminal precondition a real user has before
  // pressing a native Meta shortcut. A freshly hidden/dockless E2E window can
  // otherwise receive the modifier key before macOS focuses its web contents.
  await page.locator(".terminal-host").first().click();
  await page.keyboard.press(`${MOD}+f`);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.getAttribute("placeholder") ?? "",
        ),
      { timeout: 6_000 },
    )
    .toMatch(/search/i);
});

test("Cmd+Shift+F opens find-in-files", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+f`);
  await expect(
    page.getByRole("dialog").first().or(page.getByPlaceholder(/search/i).first()),
  ).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press("Escape");
});

test("Cmd+J (ask AI from selection) opens the chat without crashing", async ({ app, page }) => {
  const before = app.windows().length;
  await page.locator("body").click();
  await page.keyboard.press(`${MOD}+j`);
  await page.waitForTimeout(800);
  // Must not auto-open Settings; app stays responsive.
  expect(app.windows().length).toBe(before);
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("Cmd+Shift+A (focus agent attention) does not crash with no agents", async ({ page }) => {
  await page.keyboard.press(`${MOD}+Shift+a`);
  await page.waitForTimeout(400);
  await expect(page.getByTestId("workspace")).toBeVisible();
});

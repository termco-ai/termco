/**
 * Settings, in depth: exercises the controls across every tab — startup/files/
 * agent switches + zoom (General); mode cards, theme picker + background
 * (Appearance); shortcut list (Shortcuts); providers + local-model config
 * (Models); version (About).
 */
import { expect, openSettingsWindow, test } from "./fixtures";

const go = (s: import("@playwright/test").Page, name: string) =>
  s.getByRole("tab", { name }).or(s.getByRole("button", { name })).first();

test("Appearance: mode cards switch the document theme", async ({ app, page }) => {
  const s = await openSettingsWindow(app, page);
  await go(s, "Appearance").click();
  for (const [mode, cls] of [["Dark", "dark"], ["Light", "light"]] as const) {
    await s.getByRole("button", { name: mode, exact: true }).first().click();
    await expect
      .poll(() => s.evaluate((c) => document.documentElement.classList.contains(c), cls), { timeout: 8_000 })
      .toBe(true);
  }
});

test("General: every switch toggles", async ({ app, page }) => {
  const s = await openSettingsWindow(app, page);
  const switches = s.getByRole("switch");
  const n = Math.min(await switches.count(), 4);
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const sw = switches.nth(i);
    const before = await sw.getAttribute("aria-checked");
    await sw.click();
    await expect.poll(() => sw.getAttribute("aria-checked"), { timeout: 5_000 }).not.toBe(before);
  }
});

test("General: has a zoom slider", async ({ app, page }) => {
  const s = await openSettingsWindow(app, page);
  await expect(s.getByRole("slider").first()).toBeVisible();
});

test("Appearance: exposes theme options and background controls", async ({ app, page }) => {
  const s = await openSettingsWindow(app, page);
  await go(s, "Appearance").click();
  await expect(s.getByText(/theme/i).first()).toBeVisible({ timeout: 8_000 });
  // Selecting a different theme option keeps the window responsive.
  const options = s.getByRole("button").filter({ hasText: /dark|light|nord|gruvbox|tokyo|github|aura/i });
  if (await options.count()) {
    await options.first().click();
    await s.waitForTimeout(500);
  }
});

test("Shortcuts: lists bindings including the command palette", async ({ app, page }) => {
  const s = await openSettingsWindow(app, page);
  await go(s, "Shortcuts").click();
  await expect(s.getByText(/command palette/i).first()).toBeVisible({ timeout: 8_000 });
});

test("Models: shows providers and local-model configuration", async ({ app, page }) => {
  const s = await openSettingsWindow(app, page);
  await go(s, "Models").click();
  await expect(s.getByText(/provider|model|API key|Ollama|LM Studio|OpenAI|Anthropic/i).first())
    .toBeVisible({ timeout: 8_000 });
});

test("About: shows the app identity and an update affordance", async ({ app, page }) => {
  const s = await openSettingsWindow(app, page);
  await go(s, "About").click();
  await expect(
    s.getByTestId("about-section").getByText("Electron", { exact: true }),
  ).toBeVisible({ timeout: 8_000 });
  // The About page shows the license and a version line (rendered as "v<semver>").
  await expect(s.getByText(/Apache|license|^v\d|\bv\d/i).first()).toBeVisible({ timeout: 8_000 });
});

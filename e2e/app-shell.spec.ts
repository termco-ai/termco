/**
 * App-shell: the app boots into the workspace and renders all core chrome —
 * header controls, sidebar/explorer, source-control rail, terminal, and the
 * status bar — with no unexpected console errors.
 */
import { collectErrors, expect, test } from "./fixtures";

test("boots into the seeded workspace with core chrome", async ({ page }) => {
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("workspace")).toBeVisible();

  // Header controls. The search bar in the middle of the header is the command
  // palette's own input — there is no separate palette button.
  await expect(page.getByTestId("palette-bar")).toBeVisible();
  await expect(
    page.getByPlaceholder("Search or run a command…"),
  ).toBeVisible();
  for (const name of [
    "Open a new surface",
    "Settings",
    "Toggle AI panel (⌘I)",
    "Agents & Snippets",
    "New rig",
  ]) {
    await expect(page.getByRole("button", { name, exact: false }).first()).toBeVisible();
  }

  // Explorer shows the seeded files.
  await expect(page.getByRole("button", { name: "README.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "notes.txt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "src", exact: true })).toBeVisible();

  // Sidebar rail: Files / Source Control.
  await expect(page.getByRole("button", { name: "Files" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Source Control" }).first()).toBeVisible();
});

test("renders a live terminal prompt for the workspace", async ({ page }) => {
  // The terminal writes a real shell prompt into the DOM.
  await expect(page.locator("body")).toContainText("%", { timeout: 20_000 });
});

test("boots without unexpected console/page errors", async ({ app }) => {
  const page = await app.firstWindow();
  const { errors } = collectErrors(page);
  await page.getByTestId("sidebar").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(3000);
  expect(errors, `unexpected errors:\n${errors.join("\n")}`).toEqual([]);
});

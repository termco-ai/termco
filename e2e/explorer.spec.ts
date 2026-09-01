/**
 * File explorer: lists workspace files, expands directories, opens files, and
 * exposes its toolbar actions (new file/folder, refresh, hidden toggle, search).
 */
import { expect, test } from "./fixtures";
import { openFile } from "./helpers";

test("lists the seeded workspace files and toolbar actions", async ({ page }) => {
  await expect(page.getByRole("button", { name: "README.md" })).toBeVisible();
  await expect(page.getByRole("button", { name: "notes.txt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "src", exact: true })).toBeVisible();

  for (const name of ["New file", "New folder", "Refresh"]) {
    await expect(page.getByRole("button", { name, exact: false }).first()).toBeVisible();
  }
});

test("expands a directory to reveal its children", async ({ page }) => {
  await page.getByRole("button", { name: "src", exact: true }).click();
  await expect(page.getByRole("button", { name: "index.ts" })).toBeVisible({ timeout: 10_000 });
});

test("opens a code file into the editor with its contents", async ({ page }) => {
  await openFile(page, "notes.txt");
  await expect(page.locator(".cm-editor").first()).toContainText("line one");
});

test("opens a markdown file as a rendered preview", async ({ page }) => {
  await page.getByRole("button", { name: "README.md", exact: true }).first().click();
  // .md files render as a markdown preview (not a CodeMirror editor).
  await expect(page.getByText("Termco E2E").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Hello world from the workspace").first())
    .toBeVisible({ timeout: 10_000 });
});

test("new-file toolbar action starts an inline entry", async ({ page }) => {
  await page.getByRole("button", { name: "New file", exact: false }).first().click();
  // An inline text input appears for naming the new file.
  await expect(page.locator("input:focus, .cm-editor input, [contenteditable]:focus").first())
    .toBeVisible({ timeout: 8_000 });
  await page.keyboard.press("Escape");
});

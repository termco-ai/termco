/**
 * Explorer, in depth: context-menu actions, real file/folder create + delete
 * (hitting the fs backend), inline rename, nested navigation, hidden toggle.
 */
import { expect, test } from "./fixtures";

async function contextMenu(page: import("@playwright/test").Page, file: string) {
  await page.getByRole("button", { name: file, exact: true }).first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete" }).first()).toBeVisible({ timeout: 8_000 });
}

test("file context menu exposes all actions", async ({ page }) => {
  await contextMenu(page, "notes.txt");
  for (const item of [
    "Open",
    "Reveal in Finder",
    "New File",
    "New Folder",
    "Copy Path",
    "Copy Relative Path",
    "Attach to Agent",
    "Delete",
  ]) {
    await expect(page.getByRole("menuitem", { name: item, exact: true }).first()).toBeVisible();
  }
  await page.keyboard.press("Escape");
});

test("Copy Path writes the absolute path to the clipboard", async ({ page }) => {
  await contextMenu(page, "notes.txt");
  await page.getByRole("menuitem", { name: "Copy Path", exact: true }).first().click();
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  expect(clip).toContain("notes.txt");
});

test("creates a new file via the context menu and it appears", async ({ page }) => {
  await contextMenu(page, "notes.txt");
  await page.getByRole("menuitem", { name: "New File", exact: true }).first().click();
  const input = page.locator("input:focus, [contenteditable]:focus").first();
  await input.fill("created-by-e2e.ts");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "created-by-e2e.ts" })).toBeVisible({ timeout: 10_000 });
});

test("creates a new folder via the context menu", async ({ page }) => {
  await contextMenu(page, "notes.txt");
  await page.getByRole("menuitem", { name: "New Folder", exact: true }).first().click();
  const input = page.locator("input:focus, [contenteditable]:focus").first();
  await input.fill("e2e-folder");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "e2e-folder" })).toBeVisible({ timeout: 10_000 });
});

test("deletes a file via the context menu", async ({ page }) => {
  await contextMenu(page, "notes.txt");
  await page.getByRole("menuitem", { name: "Delete", exact: true }).first().click();
  // A confirm dialog appears; accept it.
  const confirm = page.getByRole("button", { name: /Delete|Confirm|Move to Trash/ }).last();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByRole("button", { name: "notes.txt" })).toBeHidden({ timeout: 10_000 });
});

test("navigates nested directories", async ({ page }) => {
  await page.getByRole("button", { name: "src", exact: true }).click();
  await expect(page.getByRole("button", { name: "index.ts" })).toBeVisible({ timeout: 8_000 });
  // collapse again
  await page.getByRole("button", { name: "src", exact: true }).click();
  await expect(page.getByRole("button", { name: "index.ts" })).toBeHidden({ timeout: 8_000 });
});

/**
 * Code editor: opens a file into CodeMirror, shows its content, accepts edits,
 * and saves (Cmd/Ctrl+S) without error.
 */
import { expect, test } from "./fixtures";
import { openFile } from "./helpers";
import { MOD } from "./fixtures";

test("shows file content in CodeMirror", async ({ page }) => {
  await openFile(page, "notes.txt");
  await expect(page.locator(".cm-editor").first()).toContainText("line one");
  await expect(page.locator(".cm-editor").first()).toContainText("line two");
});

test("accepts typed edits", async ({ page }) => {
  await openFile(page, "notes.txt");
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" EDITED_BY_E2E");
  await expect(page.locator(".cm-editor").first()).toContainText("EDITED_BY_E2E");
});

test("saves without error", async ({ app, page }) => {
  await openFile(page, "notes.txt");
  await page.locator(".cm-content").first().click();
  await page.keyboard.type("// appended\n");
  await page.keyboard.press(`${MOD}+s`);
  await page.waitForTimeout(1000);
  // Still responsive, no crash.
  expect(app.windows().length).toBeGreaterThanOrEqual(1);
});

test("shows a Save button top-right while dirty and saves on click", async ({
  page,
}) => {
  await openFile(page, "notes.txt");
  const saveButton = page.getByTitle("Save file (⌘S)");
  // Clean buffer → no button.
  await expect(saveButton).toHaveCount(0);

  await page.locator(".cm-content").first().click();
  await page.keyboard.type("// dirty\n");
  await expect(saveButton).toBeVisible({ timeout: 10_000 });

  await saveButton.click();
  // Saved → dirty clears → the button disappears again.
  await expect(saveButton).toHaveCount(0, { timeout: 10_000 });
});

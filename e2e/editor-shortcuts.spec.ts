/**
 * Editor keyboard functions: undo / redo.
 */
import { expect, MOD, test } from "./fixtures";
import { openFile } from "./helpers";

test("Cmd+Z undoes an edit; redo restores it", async ({ page }) => {
  await openFile(page, "notes.txt");
  const editor = page.locator(".cm-editor").first();
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" UNDO_TOKEN_42");
  await expect(editor).toContainText("UNDO_TOKEN_42");

  await page.keyboard.press(`${MOD}+z`);
  await expect(editor).not.toContainText("UNDO_TOKEN_42", { timeout: 8_000 });

  // Redo (editor.redo binding) restores the text.
  await page.keyboard.press(`${MOD}+y`);
  await expect(editor).toContainText("UNDO_TOKEN_42", { timeout: 8_000 });
});

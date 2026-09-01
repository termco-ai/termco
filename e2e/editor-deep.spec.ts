/**
 * Editor, in depth: opening multiple files/languages, switching between editor
 * tabs, markdown preview vs code editor, and closing.
 */
import { expect, test } from "./fixtures";
import { openFile } from "./helpers";

async function expandSrc(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "src", exact: true }).click();
  await expect(page.getByRole("button", { name: "index.ts" })).toBeVisible({ timeout: 8_000 });
}

test("opens a TypeScript file with syntax content", async ({ page }) => {
  await expandSrc(page);
  await openFile(page, "index.ts");
  await expect(page.locator(".cm-editor").first()).toContainText("answer");
  await expect(page.locator(".cm-editor").first()).toContainText("42");
});

test("opens two different files in the editor", async ({ page }) => {
  await expandSrc(page);
  await openFile(page, "notes.txt");
  await expect(page.locator(".cm-editor").first()).toContainText("line one");
  // Files open in preview mode (each replaces the last) — open a second one.
  await page.getByRole("button", { name: "index.ts" }).first().click();
  await expect(page.locator(".cm-editor").first()).toContainText("answer", { timeout: 10_000 });
});

test("renders markdown as a preview, code as an editor", async ({ page }) => {
  await page.getByRole("button", { name: "README.md", exact: true }).first().click();
  await expect(page.getByText("Termco E2E").first()).toBeVisible({ timeout: 12_000 });
  await expect(page.locator(".cm-editor")).toHaveCount(0);
});

test("edits and the change is reflected", async ({ page }) => {
  await openFile(page, "notes.txt");
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // trailing");
  await expect(page.locator(".cm-editor").first()).toContainText("// trailing");
});

import { expect, MOD, test } from "./fixtures";

test("opens a working, resizable terminal below a file and keeps unsaved edits", async ({ page, workspace }, testInfo) => {
  await page.getByTestId("onboarding-offer").getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "notes.txt", exact: true }).first().click();
  const editor = page.locator(".cm-editor:visible");
  await expect(editor).toBeVisible();
  await editor.locator(".cm-content").click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(" unsaved split test");
  await page.getByRole("tab", { name: /notes.txt/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open Terminal Below", exact: true }).click();

  const bottom = page.locator('[id="ws-right"]');
  const top = page.locator('[id="ws-left"]');
  await expect(page.getByRole("button", { name: "Close bottom pane", exact: true })).toBeVisible();
  await expect(editor).toContainText("unsaved split test");
  const upper = await top.boundingBox();
  const lower = await bottom.boundingBox();
  expect(upper).not.toBeNull();
  expect(lower).not.toBeNull();
  expect(lower!.y).toBeGreaterThanOrEqual(upper!.y + upper!.height - 1);
  expect(Math.abs(lower!.width - upper!.width)).toBeLessThan(2);

  const terminal = bottom.locator("[data-terminal-padding]:visible");
  await expect(terminal).toContainText("%", { timeout: 20_000 });
  await terminal.click();
  await page.keyboard.type("printf 'BELOW_OK:%s\\n' \"$PWD\"");
  await page.keyboard.press("Enter");
  await expect(terminal).toContainText(new RegExp(`BELOW_OK:.*${workspace.dir.split("/").at(-1)}`));
  await expect(editor).toContainText("unsaved split test");

  const separator = page.locator('[data-workspace-surface] [role="separator"]').first();
  const handle = await separator.boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y - 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await bottom.boundingBox())!.height).toBeGreaterThan(lower!.height + 30);

  await page.screenshot({ path: testInfo.outputPath("terminal-below.png") });

  // Closing the focused terminal via the shortcut must keep the file open.
  await terminal.click();
  await page.keyboard.press(`${MOD}+w`);
  await expect(page.getByRole("button", { name: "Close bottom pane", exact: true })).toHaveCount(0);
  await expect(editor).toContainText("unsaved split test");
  await expect(page.getByRole("tab", { name: /notes.txt/ })).toBeVisible();
});

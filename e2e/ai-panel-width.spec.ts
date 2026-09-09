import { collectErrors, expect, MOD, configuredAiTest as test } from "./fixtures";

test("AI chat expands to the left sidebar and can shrink again without losing work", async ({ app, page }, testInfo) => {
  const { errors } = collectErrors(page);
  await page.getByRole("button", { name: "notes.txt", exact: true }).first().click();
  const editor = page.locator(".cm-editor:visible .cm-content");
  await editor.click();
  await page.keyboard.press(`${MOD}+End`);
  await page.keyboard.type(" keep my editor draft");

  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  const panel = page.locator('[data-onboarding-target="ai-chat.panel"]');
  const handle = page.getByRole("separator", { name: "Resize AI panel" });
  const composer = panel.getByPlaceholder("Describe the outcome you want…");
  await expect(composer).toBeVisible();
  await composer.fill("Keep this chat draft while resizing");
  const sidebar = page.locator('[id="sidebar"]');
  const initialSidebar = (await sidebar.boundingBox())!;
  const initialHandle = (await handle.boundingBox())!;
  await page.mouse.move(initialHandle.x + initialHandle.width / 2, initialHandle.y + initialHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, initialHandle.y + initialHandle.height / 2, { steps: 15 });
  await page.mouse.up();

  async function expectFullWidth() {
    await expect.poll(async () => {
      const chat = (await panel.boundingBox())!;
      const workspace = (await page.locator("[data-workspace-surface]").boundingBox())!;
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      return Math.abs(chat.x - workspace.x) < 2 && Math.abs(chat.x + chat.width - viewportWidth) < 2;
    }).toBe(true);
  }
  await expectFullWidth();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(560);
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(initialSidebar.width, 0);
  await expect(composer).toHaveValue("Keep this chat draft while resizing");
  await page.screenshot({ path: testInfo.outputPath("chat-to-sidebar.png"), animations: "disabled" });

  // The same dock width applies to agent conversations.
  await panel.getByRole("button", { name: "agents", exact: true }).click();
  await expectFullWidth();
  await panel.getByRole("button", { name: "chat", exact: true }).click();

  // A narrower window clamps the panel to the current sidebar boundary.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 650));
  await expectFullWidth();
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  await expect(editor).toContainText("keep my editor draft");
  await editor.click();
  await page.keyboard.press(`${MOD}+z`);
  await expect(editor).not.toContainText("keep my editor draft");

  // The user can expand it again with the keyboard too.
  await handle.focus();
  await page.keyboard.press("End");
  await expectFullWidth();
  expect(errors.filter((error) => /ResizeObserver loop/i.test(error))).toEqual([]);
});

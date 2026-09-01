/**
 * AI panel, in depth: opening the chat never auto-routes to Settings; a
 * conversation exposes a model picker / connect affordance and a working
 * composer. (No live model calls.)
 */
import { expect, test } from "./fixtures";
import { openAiConversation, openAiPanel } from "./helpers";

test("opening the chat never spawns a Settings window", async ({ app, page }) => {
  const before = app.windows().length;
  await openAiPanel(page);
  expect(app.windows().length).toBe(before);
});

test("a conversation exposes a model picker or connect affordance", async ({ page }) => {
  await openAiConversation(page);
  const control = page
    .getByTestId("model-picker")
    .or(page.getByTestId("model-dropdown"))
    .or(page.getByRole("button", { name: /model|provider|Connect|Claude|GPT|Ollama|Auto/i }))
    .first();
  await expect(control).toBeVisible({ timeout: 10_000 });
});

test("the composer accepts typed input", async ({ page }) => {
  await openAiConversation(page);
  const composer = page.getByRole("textbox").last();
  if (!(await composer.isVisible().catch(() => false))) {
    test.skip(true, "no provider configured — composer replaced by connect notice");
  }
  await composer.click();
  await composer.pressSequentially("SummarizeRepoE2E");
  await expect
    .poll(
      async () => {
        const v = await composer.inputValue().catch(() => null);
        return v ?? (await composer.textContent().catch(() => "")) ?? "";
      },
      { timeout: 8_000 },
    )
    .toContain("SummarizeRepoE2E");
});

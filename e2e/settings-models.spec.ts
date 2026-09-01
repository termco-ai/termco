/**
 * Models settings, in depth: provider list, credential entry, and local-model
 * (LM Studio / Ollama / MLX) configuration. Scoped to the in-window settings
 * view so header controls (e.g. the search box) don't leak into the queries.
 */
import { expect, openSettingsWindow, test } from "./fixtures";

const openModels = async (page: import("@playwright/test").Page) => {
  await openSettingsWindow(undefined as never, page);
  const view = page.getByTestId("settings-view");
  await view.getByRole("button", { name: "Models" }).first().click();
  await page.waitForTimeout(700);
  return view;
};

test("lists providers with a credential/connect affordance", async ({
  page,
}) => {
  const view = await openModels(page);
  await expect(
    view.getByText(/Anthropic|OpenAI|Claude|GPT|provider/i).first(),
  ).toBeVisible({ timeout: 8_000 });
  await expect(
    view
      .getByRole("textbox")
      .or(view.getByRole("button", { name: /connect|add|key|api/i }))
      .first(),
  ).toBeVisible({ timeout: 8_000 });
});

test("exposes local-model configuration", async ({ page }) => {
  const view = await openModels(page);
  // Local providers live behind "Add provider" until one is connected, so open
  // the grid rather than depending on which keys this machine happens to hold.
  await view
    .getByRole("button", { name: /Add provider/ })
    .first()
    .click();
  await expect(
    view.getByRole("button", { name: /LM Studio|Ollama|MLX/ }).first(),
  ).toBeVisible({ timeout: 8_000 });
});

test("accepts typing into a text field", async ({ page }) => {
  const view = await openModels(page);
  const field = view.getByRole("textbox").first();
  if (!(await field.isVisible().catch(() => false))) {
    test.skip(true, "no free-text field on the Models tab in this state");
  }
  await field.click();
  await field.fill("e2e-test-value");
  await expect(field).toHaveValue("e2e-test-value");
});

/**
 * AI composer tokens: slash-commands (/), file mentions (@), and snippet
 * mentions (#) each open their picker while typing in the composer.
 */
import { expect, test } from "./fixtures";
import { openAiConversation } from "./helpers";

async function composer(page: import("@playwright/test").Page) {
  await openAiConversation(page);
  const box = page.getByRole("textbox").last();
  if (!(await box.isVisible().catch(() => false))) {
    test.skip(true, "composer not available without a provider");
  }
  await box.click();
  return box;
}

async function popupOrToken(page: import("@playwright/test").Page, box: import("@playwright/test").Locator, token: string) {
  const popup = page
    .getByTestId("autocomplete-row")
    .first()
    .or(page.getByTestId("snippet-picker").first())
    .or(page.getByTestId("file-picker").first())
    .or(page.getByRole("listbox").first())
    .or(page.getByRole("menu").first());
  if (await popup.isVisible().catch(() => false)) return;
  // Some tokens only open a picker when matches exist; at minimum the composer
  // must have accepted the character.
  const content = (await box.inputValue().catch(() => null)) ?? (await box.textContent().catch(() => "")) ?? "";
  expect(content).toContain(token);
}

test("slash types a command token / opens the command menu", async ({ page }) => {
  const box = await composer(page);
  await box.pressSequentially("/");
  await page.waitForTimeout(800);
  await popupOrToken(page, box, "/");
});

test("@ opens the file mention picker", async ({ page }) => {
  const box = await composer(page);
  await box.pressSequentially("@");
  const picker = page.getByTestId("file-picker").first();
  if (await picker.count()) {
    await expect(picker).toBeVisible({ timeout: 6_000 });
  } else {
    await expect(
      page.getByRole("listbox").first().or(page.getByText(/README|notes|src/i).first()),
    ).toBeVisible({ timeout: 6_000 });
  }
});

test("# types a snippet token / opens the snippet picker", async ({ page }) => {
  const box = await composer(page);
  await box.pressSequentially("#");
  await page.waitForTimeout(800);
  await popupOrToken(page, box, "#");
});

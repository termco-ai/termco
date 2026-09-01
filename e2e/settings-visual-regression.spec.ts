import { expect, openSettingsWindow, test } from "./fixtures";

async function assertNoVisibleHorizontalClipping(
  locator: import("@playwright/test").Locator,
): Promise<void> {
  const result = await locator.evaluate((root) => {
    const rootRect = root.getBoundingClientRect();
    const clipped = [...root.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, [role=button], [role=tab], [role=switch]",
    )]
      .filter((element) => element.offsetParent !== null)
      // Terminal engines keep an intentionally off-screen textarea for IME
      // input. It is not a visible control and must not count as clipped UI.
      .filter((element) => !element.classList.contains("xterm-helper-textarea"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) return false;
        return rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1;
      })
      .map((element) => ({
        name: element.getAttribute("aria-label") ?? element.textContent?.trim(),
        html: element.outerHTML.slice(0, 120),
      }));
    return {
      clipped,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });
  expect(result.clipped).toEqual([]);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
}

test("app shell keeps its visual hierarchy at desktop and compact window sizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page).toHaveScreenshot("app-shell-1280.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
  });
  await assertNoVisibleHorizontalClipping(page.getByTestId("workspace"));

  await page.setViewportSize({ width: 900, height: 650 });
  await expect(page).toHaveScreenshot("app-shell-compact.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
  });
  await assertNoVisibleHorizontalClipping(page.getByTestId("workspace"));
});

test("Plugin Manager remains dense, readable, and unclipped", async ({ app, page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Plugins", exact: true }).click();
  await settings.getByTestId("plugins-section").waitFor({ state: "visible" });
  await expect(page).toHaveScreenshot("plugin-manager.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
  });
  await assertNoVisibleHorizontalClipping(settings.getByTestId("settings-view"));
});

test("model settings preserve form spacing and context controls", async ({ app, page }) => {
  await page.setViewportSize({ width: 1180, height: 760 });
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Models" }).first().click();
  await settings.getByTestId("models-settings-section").waitFor({
    state: "visible",
  });
  await expect(page).toHaveScreenshot("model-settings.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
  });
  await assertNoVisibleHorizontalClipping(settings.getByTestId("settings-view"));
});

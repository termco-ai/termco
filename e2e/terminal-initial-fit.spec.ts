import { expect, test } from "./fixtures";

async function geometry(page: import("@playwright/test").Page) {
  return page.locator("[data-terminal-padding]").first().evaluate((wrapper) => {
    const grid = wrapper.querySelector(".term-grid")?.getBoundingClientRect();
    return {
      wrapperHeight: wrapper.getBoundingClientRect().height,
      gridHeight: grid?.height ?? 0,
    };
  });
}

test("terminal fits a tall window on initial render", async ({ app, page }) => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1100, 1000);
  });
  await page.reload();

  const terminal = page.locator("[data-terminal-padding]").first();
  await expect(terminal).toBeVisible();

  await expect
    .poll(async () => {
      const { wrapperHeight, gridHeight } = await geometry(page);
      return wrapperHeight - gridHeight;
    })
    .toBeLessThan(24);
});

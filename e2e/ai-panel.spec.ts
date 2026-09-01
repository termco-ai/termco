/**
 * AI panel: toggling it opens the chat INLINE — it must never auto-route a
 * keyless user to Settings. When no provider is configured the chat shows an
 * inline "Connect provider" notice; reaching Settings takes an explicit click.
 */
import { collectErrors, expect, test } from "./fixtures";

test("toggling AI opens the chat inline and never auto-opens Settings", async ({ app, page }) => {
  const before = app.windows().length;
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await page.waitForTimeout(1200);
  // The core requirement: no settings window is spawned.
  expect(app.windows().length, "AI toggle must not auto-open a Settings window").toBe(before);
  // The chat surface is present and ready without a redundant launch step.
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 10_000 });
});

test("resizing the workspace with the AI dock does not trigger a ResizeObserver loop", async ({
  app,
  page,
}) => {
  const { errors } = collectErrors(page);
  await page.evaluate(() => {
    const target = window as typeof window & {
      __termcoE2EResizeObserverErrors?: string[];
    };
    target.__termcoE2EResizeObserverErrors = [];
    window.addEventListener(
      "error",
      (event) => {
        if (/ResizeObserver loop/i.test(event.message)) {
          target.__termcoE2EResizeObserverErrors?.push(event.message);
        }
      },
      true,
    );
  });
  const toggle = page.getByRole("button", { name: /Toggle AI panel/ }).first();
  const panel = page.getByTestId("ai-panel");

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1_200, 800);
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const target = window as typeof window & {
      __termcoE2EResizeObserverErrors?: string[];
    };
    target.__termcoE2EResizeObserverErrors = [];
  });

  await toggle.click();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(250);

  const observerErrors = await page.evaluate(
    () =>
      (window as typeof window & { __termcoE2EResizeObserverErrors?: string[] })
        .__termcoE2EResizeObserverErrors ?? [],
  );
  expect([
    ...errors.filter((error) => /ResizeObserver loop/i.test(error)),
    ...observerErrors,
  ]).toEqual([]);
});

test("the connect notice informs the user without navigating away", async ({ app, page }) => {
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  const connect = page.getByRole("button", { name: /Connect provider/ }).first();
  if (await connect.isVisible().catch(() => false)) {
    // The notice text explains a key is needed, and Settings only opens on click.
    await expect(page.getByText(/provider|key|keychain/i).first()).toBeVisible({ timeout: 8_000 });
    expect(app.windows().length).toBe(1);
    const waitWin = app.waitForEvent("window", { timeout: 12_000 }).catch(() => null);
    await connect.click();
    expect(await waitWin, "explicit Connect click opens Settings").toBeTruthy();
  }
});

test("uses one compact control for thinking level and transcript visibility", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  const panel = page.getByTestId("ai-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // Drag the dock narrower than its allowed floor. The panel must stop before
  // composer actions can push Send outside the visible surface.
  const dockHandle = page.getByRole("separator").last();
  const handleBox = await dockHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(
    (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
    (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.mouse.move((handleBox?.x ?? 0) + 240, handleBox?.y ?? 0);
  await page.mouse.up();

  const thinking = page.getByRole("button", { name: /^Thinking level:/ });
  await expect(thinking).toHaveCount(1);
  await expect(thinking).toBeVisible();
  await expect(
    page.getByRole("button", { name: /thinking in transcript/i }),
  ).toHaveCount(0);

  await thinking.click();
  await expect(page.getByText("Thinking level", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("menuitemcheckbox", {
      name: /Show thinking in transcript/,
    }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  const send = page.getByRole("button", { name: "Send" });
  const panelBox = await panel.boundingBox();
  const sendBox = await send.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(sendBox).not.toBeNull();
  expect(panelBox?.width ?? 0).toBeGreaterThanOrEqual(359);
  expect((sendBox?.x ?? 0) + (sendBox?.width ?? 0)).toBeLessThanOrEqual(
    (panelBox?.x ?? 0) + (panelBox?.width ?? 0),
  );
  expect(Math.abs((sendBox?.width ?? 0) - (sendBox?.height ?? 0))).toBeLessThan(
    1,
  );
  await expect(send.locator("[data-send-label]")).toBeHidden();
});

test("opens the Agents & Snippets manager", async ({ page }) => {
  await page.getByRole("button", { name: /Agents & Snippets/ }).first().click();
  await page.waitForTimeout(800);
  await expect(page.getByText(/Agents|Snippets/i).first()).toBeVisible({ timeout: 10_000 });
});

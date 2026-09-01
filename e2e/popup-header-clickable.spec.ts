/**
 * Regression: the floating AI mini-window (popup chat) header must stay
 * clickable and closable.
 *
 * The bug: modal Radix dropdowns inside the popup/header (model picker, session
 * picker, agent switcher) set `document.body { pointer-events: none }` while
 * open and only restore it on close. If such a menu's host is torn down while
 * still open, the lock is stranded and the ENTIRE popup — the Close (X) button
 * included — goes unclickable while remaining fully visible. The fix makes those
 * dropdowns non-modal and adds a mount/unmount safety net that clears a stranded
 * lock, so the popup can always be recovered (via Escape) and closed.
 */
import { collectErrors, expect, isBenignError, test } from "./fixtures";

/** Seed an Anthropic key so `hasComposer` flips true and the popup can open. */
async function seedProviderKey(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    await window.__termco.capabilityCall({
      consumerPluginId: "ai-chat-native",
      capability: "secrets.application",
      method: "set",
      args: ["termco-ai", "anthropic-api-key", "sk-ant-e2e-000"],
    });
    await window.__termco.capabilityCall({
      consumerPluginId: "ai-chat-native",
      capability: "events.application",
      method: "emit",
      args: ["termco://ai-keys-changed", null],
    });
  });
  // Let the keys reload propagate to `hasComposer`.
  await page.waitForTimeout(800);
}

/** Open the AI dock (with a key present it opens straight into a conversation),
 * then Float it into the floating mini-window. */
async function openMiniWindow(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: /Toggle AI panel/ })
    .first()
    .click();
  const float = page.getByRole("button", { name: "Float" }).first();
  await expect(float).toBeVisible({ timeout: 15_000 });
  await float.click();
  await expect(page.locator("[data-ai-mini-window]")).toBeVisible({
    timeout: 15_000,
  });
}

test("the popup header close button actually closes the popup", async ({
  page,
}) => {
  const { errors } = collectErrors(page);
  await seedProviderKey(page);
  await openMiniWindow(page);

  // The real-world bug: the popup overlaps the titlebar's `-webkit-app-region:
  // drag` region, so on macOS the OS eats real clicks as window-drag (Playwright
  // injects below the OS layer, so it can't reproduce that — but it CAN assert
  // the popup opts out of the drag region, which is the fix).
  const region = await page
    .locator("[data-ai-mini-window]")
    .evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-app-region"));
  expect(region).toBe("no-drag");

  await page.locator('[data-ai-mini-window] [aria-label="Close"]').click();

  await expect(page.locator("[data-ai-mini-window]")).toHaveCount(0, {
    timeout: 5_000,
  });
  expect(errors.filter((e) => !isBenignError(e))).toEqual([]);
});

test("a stranded body pointer-events lock never leaves the popup permanently stuck", async ({
  page,
}) => {
  await seedProviderKey(page);
  await openMiniWindow(page);

  // Reproduce the failure mode: a modal Radix layer stranded the app-wide lock.
  await page.evaluate(() => {
    document.body.style.pointerEvents = "none";
  });

  // With the lock stranded, a pointer click on the X can't land — the topmost
  // element at the button's center is no longer the button (mechanism proven).
  const intercepted = await page.evaluate(() => {
    const btn = document.querySelector(
      '[data-ai-mini-window] [aria-label="Close"]',
    ) as HTMLElement | null;
    if (!btn) return "no-button";
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return top === btn || btn.contains(top) ? "reaches-button" : "intercepted";
  });
  expect(intercepted).toBe("intercepted");

  // Escape is a keyboard event — it bypasses the pointer lock, closes the popup,
  // and the mini-window's unmount safety net clears the stranded lock.
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-ai-mini-window]")).toHaveCount(0, {
    timeout: 5_000,
  });
  const bodyPE = await page.evaluate(() => document.body.style.pointerEvents);
  expect(bodyPE).not.toBe("none");
});

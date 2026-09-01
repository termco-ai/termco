/**
 * Anthropic against a REAL model — the regression proof for the
 * system-message fix (AI SDK 7).
 *
 * v7's `standardizePrompt` throws `InvalidPromptError` on any `role:"system"`
 * message inside `messages`; our Anthropic prompt path used to put its cached
 * system blocks exactly there, so EVERY Anthropic run died at stream start —
 * invisible to the unit suite, which mocks `streamText`. The fix moves the
 * blocks to `instructions: SystemModelMessage[]` with the cacheControl
 * breakpoint on the last block.
 *
 * Two live assertions:
 *  1. Turn 1 produces an assistant reply at all (pre-fix: an instant error).
 *  2. Turn 2 shows cached input tokens ("Of which cached" in the context
 *     popover) — proving the cacheControl breakpoints SURVIVED the move to
 *     `instructions`; losing them silently would 10x Anthropic input cost.
 *
 * Needs `ANTHROPIC_API_KEY=…` in `.env.e2e` (gitignored); the key is seeded
 * into the throwaway userData, never the OS keychain. Skips without it.
 */
import type { Page } from "@playwright/test";
import { expect, liveAnthropicKey, liveTest } from "./fixtures";
import { openAiPanel } from "./helpers";

const KEY = liveAnthropicKey();

const panelOf = (page: Page) => page.getByTestId("ai-panel");

const composer = (page: Page) =>
  panelOf(page).getByPlaceholder("Describe the outcome you want…").first();

const stopButton = (page: Page) =>
  panelOf(page).getByRole("button", { name: "Stop", exact: true });

/** Send a turn and wait for the stream to finish (Stop appears, then goes). */
async function send(page: Page, text: string, timeout = 120_000): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(stopButton(page)).toBeVisible({ timeout: 30_000 });
  await expect(stopButton(page)).toBeHidden({ timeout });
}

/** Pick the target model in the composer's model browser. */
async function pickClaude(page: Page): Promise<void> {
  const panel = panelOf(page);
  // The trigger is the composer's model button (title "Model: <label>").
  await panel.locator('button[title^="Model:"]').first().click();
  const browser = page.locator("[data-model-browser]");
  await browser.waitFor({ state: "visible", timeout: 10_000 });
  await browser.locator("[data-model-search]").fill("claude sonnet");
  const row = browser
    .getByRole("menuitem")
    .filter({ hasText: "Claude Sonnet 5" })
    .first();
  await row.click();
  await browser.waitFor({ state: "hidden", timeout: 10_000 });
}

liveTest.describe("anthropic with a live model", () => {
  liveTest.skip(!KEY, "no .env.e2e with ANTHROPIC_API_KEY — live spec skipped");
  liveTest.setTimeout(300_000);

  liveTest(
    "streams a reply and hits the prompt cache on the second turn",
    async ({ page }) => {
      await openAiPanel(page);
      const panel = panelOf(page);
      await pickClaude(page);

      // Turn 1 — pre-fix this failed instantly with InvalidPromptError
      // ("System messages are not allowed in the prompt or messages fields").
      // The expected answer must NOT appear in the prompt, or the assertion
      // matches the user's own message and proves nothing.
      await send(page, "What is 3*7? Reply with just the number.");
      await expect(panel.getByText("21").last()).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        panel.getByText(/System messages are not allowed/i),
        "the Anthropic prompt path must not trip v7's system-message guard",
      ).toHaveCount(0);

      // Turn 2 — the stable system prefix (cacheControl on the last
      // instructions block) must land as a cache read.
      await send(page, "And 4*7? Just the number.");

      // The context readout is a Radix HoverCard; in the hidden E2E window
      // hover events don't land, but the trigger also opens on FOCUS. Its
      // accessible name comes from the ring icon's svg label.
      await panel
        .getByRole("button", { name: /Model context usage/ })
        .focus();
      const cachedRow = page.getByText("Of which cached", { exact: true });
      await expect(
        cachedRow,
        "turn 2 must read the turn-1 prompt from the Anthropic cache — " +
          "no cached tokens means the breakpoints were lost in the " +
          "instructions move",
      ).toBeVisible({ timeout: 10_000 });
    },
  );
});

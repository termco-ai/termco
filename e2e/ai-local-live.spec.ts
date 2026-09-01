/**
 * Live smoke against a LOCAL OpenAI-compatible model (no API key, no cost).
 *
 * Expects a router at `TERMCO_E2E_LOCAL_BASE` (default
 * `http://127.0.0.1:20128/v1`) — e.g. the developer's local proxy. Skips when
 * unreachable, so CI and clean machines stay green.
 *
 * What this proves live, end to end, that the mocked unit suite cannot:
 * the whole AI SDK 7 call surface of runStream — provider-aware prompt
 * assembly, `reasoning`, `timeout` (chunk stall detector), the signed
 * `toolApproval` policy, and the per-step performance stats feeding the
 * context readout's "Speed" row.
 */
import type { Page } from "@playwright/test";
import {
  expect,
  seedCustomEndpoint,
  seedWorkspace,
  test as base,
} from "./fixtures";
import { openAiPanel } from "./helpers";

const BASE =
  process.env.TERMCO_E2E_LOCAL_BASE?.trim() || "http://127.0.0.1:20128/v1";
const MODEL_ID =
  process.env.TERMCO_E2E_LOCAL_MODEL?.trim() || "gh/gpt-5.6-sol";

async function localModelAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/models`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// NOTE: `defaultModelId` cannot be seeded to a compat model — `loadPreferences`
// validates it with `isKnownModelId`, which only knows static models. The
// endpoint is seeded here; the model is selected through the picker UI.
const localTest = base.extend({
  workspace: async ({}, use) => {
    const ws = seedWorkspace();
    seedCustomEndpoint(ws, {
      id: "e2e-local",
      name: "E2E Local",
      baseURL: BASE,
      modelId: MODEL_ID,
      contextLimit: 200_000,
    });
    await use(ws);
  },
});

const panelOf = (page: Page) => page.getByTestId("ai-panel");

const composer = (page: Page) =>
  panelOf(page).getByPlaceholder("Describe the outcome you want…").first();

const stopButton = (page: Page) =>
  panelOf(page).getByRole("button", { name: "Stop", exact: true });

async function send(page: Page, text: string, timeout = 120_000): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(stopButton(page)).toBeVisible({ timeout: 30_000 });
  await expect(stopButton(page)).toBeHidden({ timeout });
}

/** Pick the seeded local endpoint's model in the composer's model browser. */
async function pickLocalModel(page: Page): Promise<void> {
  const panel = panelOf(page);
  await panel.locator('button[title^="Model:"]').first().click();
  const browser = page.locator("[data-model-browser]");
  await browser.waitFor({ state: "visible", timeout: 10_000 });
  await browser.locator("[data-model-search]").fill("E2E Local");
  const row = browser
    .getByRole("menuitem")
    .filter({ hasText: "E2E Local" })
    .first();
  await row.click();
  await browser.waitFor({ state: "hidden", timeout: 10_000 });
}

localTest.describe("local live model", () => {
  localTest.setTimeout(300_000);

  localTest(
    "renders real AI SDK chunks before the provider stream finishes",
    async ({ page }) => {
      localTest.skip(
        !(await localModelAvailable()),
        `no local model at ${BASE} — local live spec skipped`,
      );
      await openAiPanel(page);
      const panel = panelOf(page);
      await pickLocalModel(page);

      await composer(page).fill(
        "Write a continuous 500-word explanation of how trees grow. Do not use tools and do not shorten the answer.",
      );
      await composer(page).press("Enter");
      await expect(stopButton(page)).toBeVisible({ timeout: 30_000 });

      const assistant = panel.locator('[data-message-role="assistant"]').last();
      const assistantTextLength = async () => {
        if (await assistant.count() === 0) return 0;
        return (await assistant.textContent({ timeout: 1_000 }))?.length ?? 0;
      };
      await expect
        .poll(assistantTextLength, {
          message: "the real provider's first assistant chunks must reach Chat",
          timeout: 120_000,
        })
        .toBeGreaterThan(80);
      await expect(
        stopButton(page),
        "partial assistant text must be visible while the provider is still streaming",
      ).toBeVisible();

      const partialLength = await assistantTextLength();
      await expect
        .poll(assistantTextLength, {
          message: "Chat must continue growing from direct AI SDK chunks",
          timeout: 30_000,
        })
        .toBeGreaterThan(partialLength + 80);
      await expect(
        stopButton(page),
        "Chat growth must happen before the provider stream closes",
      ).toBeVisible();

      await stopButton(page).click();
      await expect(stopButton(page)).toBeHidden({ timeout: 5_000 });
    },
  );

  localTest(
    "streams a reply and reports per-step speed in the context readout",
    async ({ page }) => {
      localTest.skip(
        !(await localModelAvailable()),
        `no local model at ${BASE} — local live spec skipped`,
      );
      await openAiPanel(page);
      const panel = panelOf(page);
      await pickLocalModel(page);

      // The expected answer must NOT appear in the prompt, or the assertion
      // matches the user's own message and proves nothing.
      await send(page, "What is 3*7? Reply with just the number.");
      await expect(panel.getByText("21").last()).toBeVisible({
        timeout: 15_000,
      });
      // The v7 prompt path must not trip the system-message guard on any
      // provider route.
      await expect(
        panel.getByText(/System messages are not allowed/i),
      ).toHaveCount(0);

      // P2.1: per-step performance stats surface as the "Speed" row. The
      // readout is a Radix HoverCard; in the hidden E2E window hover events
      // don't land, but the trigger also opens on FOCUS.
      await panel
        .getByRole("button", { name: /Model context usage/ })
        .focus();
      await expect(
        page.getByText("Speed", { exact: true }),
        "the context readout must show tokens/sec from StepResultPerformance",
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/\d+ tok\/s/)).toBeVisible({
        timeout: 5_000,
      });
    },
  );

});

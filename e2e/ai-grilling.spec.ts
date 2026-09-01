/**
 * Grilling: the agent asks one question at a time through the `ask_user` tool
 * and waits. The answer flow seeds both the canonical session events and the
 * live Chat projection, then drives the card like a user would.
 *
 * Answering completes the tool call, which makes the chat resume on its own.
 * Without provider keys that follow-up request fails — expected here, and
 * irrelevant: what this proves is the UI transition and the decision log.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openAiPanel } from "./helpers";

const QUESTION = "Where does the grilling session state live?";
const RECOMMENDED = "Derive it from the transcript";

async function historyCall<T>(
  page: Page,
  method: "append" | "readWindow",
  args: readonly unknown[],
): Promise<T> {
  return await page.evaluate(
    ([selectedMethod, selectedArgs]) => window.__termco.capabilityCall({
      consumerPluginId: "trajectory-native",
      capability: "session.history",
      method: selectedMethod,
      args: selectedArgs,
    }),
    [method, args] as const,
  ) as T;
}

/** Put one canonical suspended question into the active chat and its ledger. */
async function seedPendingQuestion(page: Page): Promise<string> {
  const sessionId = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __termcoE2E?: {
          aiSessionState?: () => {
            activeSessionId?: string | null;
            sessions?: Array<{ id: string }>;
          };
        };
      }
    ).__termcoE2E?.aiSessionState?.();
    const id = state?.activeSessionId ?? state?.sessions?.[0]?.id;
    if (!id) throw new Error("No active AI session");
    return id;
  });
  const input = {
    question: QUESTION,
    context: "Everything downstream depends on this.",
    topic: "The grilling plan",
    estimatedRemaining: 2,
    options: [
      {
        label: RECOMMENDED,
        description: "One source of truth, persisted for free",
        recommended: true,
      },
      { label: "A separate store" },
    ],
  };
  const assistant = {
    id: "e2e-assistant",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-ask_user",
        toolCallId: "e2e-q1",
        state: "input-available",
        input,
      },
    ],
  };
  const contributor = { pluginId: "ai-tools-ask-user-native", contributionId: "ask-user" };
  await historyCall(page, "append", [sessionId, [
    { type: "turn/start", time: Date.now(), data: { turn: 1, cause: "user" } },
    {
      type: "user/message",
      time: Date.now(),
      data: {
        turn: 1,
        message: { id: "e2e-user", role: "user", parts: [{ type: "text", text: "Grill me on the plan." }] },
        source: "human",
      },
      surfaceOp: { op: "append" },
    },
    { type: "step/start", time: Date.now(), data: { turn: 1, step: 1 } },
    {
      type: "request/header",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        requestId: "e2e-question-request",
        reason: "initial",
        header: {
          selectedModelId: "e2e-model",
          providerRoute: "openai-compatible",
          providerModelId: "e2e-model",
          systemPrompt: "System",
          messages: [{ role: "user", content: "Grill me on the plan." }],
          tools: [{ name: "ask_user", schema: { type: "object", properties: {} }, contributor }],
          activeTools: ["ask_user"],
          maxSteps: 100,
          approvalPolicy: { mode: "ask" },
        },
      },
    },
    { type: "request/attempt", time: Date.now(), data: { requestId: "e2e-question-request", attempt: 1 } },
    {
      type: "tool/call",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        requestId: "e2e-question-request",
        callId: "e2e-q1",
        name: "ask_user",
        rawArguments: JSON.stringify(input),
        parsedInput: input,
        contributor,
        concurrency: "exclusive",
      },
    },
    {
      type: "assistant/message",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        requestId: "e2e-question-request",
        message: assistant,
        finishReason: "tool-calls",
      },
      surfaceOp: { op: "append" },
    },
    {
      type: "turn/suspend",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        reason: "human-input",
        callIds: ["e2e-q1"],
        approvalIds: [],
      },
    },
  ], { durability: "flushed" }]);
  const seeded = await page.evaluate(
    (message) => {
      const hook = (
        window as unknown as {
          __termcoE2E?: { aiSeedMessages: (m: unknown[]) => boolean };
        }
      ).__termcoE2E;
      if (!hook) throw new Error("E2E hook not present");
      return hook.aiSeedMessages([
        { id: "e2e-user", role: "user", parts: [{ type: "text", text: "Grill me on the plan." }] },
        message,
      ]);
    },
    assistant,
  );
  expect(seeded, "no active chat session to seed").toBe(true);
  return sessionId;
}

test("a streaming question resolves into the real card", async ({ page }) => {
  await openAiPanel(page);
  await page.evaluate(
    ({ question }) => {
      const hook = (
        window as unknown as {
          __termcoE2E?: { aiSeedMessages: (m: unknown[]) => boolean };
        }
      ).__termcoE2E;
      const part = (state: string, input: unknown) => ({
        id: "e2e-assistant",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "tool-ask_user", toolCallId: "e2e-q1", state, input },
        ],
      });
      // Half-streamed input must never surface as a real question …
      hook?.aiSeedMessages([part("input-streaming", { question: "Where doe" })]);
      // … and the completed call must replace it.
      setTimeout(() => {
        hook?.aiSeedMessages([
          part("input-available", { question, options: [{ label: "Alpha" }] }),
        ]);
      }, 300);
    },
    { question: QUESTION },
  );

  await expect(page.getByText("Preparing a question…")).toBeVisible();
  await expect(page.getByTestId("ask-user-card")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("ask-user-card")).toContainText(QUESTION);
  await expect(page.getByText("Preparing a question…")).toHaveCount(0);
});

test("the agent's question is answered in the transcript and logged", async ({
  page,
}) => {
  await openAiPanel(page);
  const sessionId = await seedPendingQuestion(page);

  // The question card replaces the generic tool row.
  const card = page.getByTestId("ask-user-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(QUESTION);
  await expect(card).toContainText("Recommended");
  await expect(page.getByTestId("tool")).toHaveCount(0);

  // Nothing can be submitted before a choice is made.
  const answer = page.getByRole("button", { name: /Answer/ });
  await expect(answer).toBeDisabled();

  await page.getByRole("button", { name: new RegExp(RECOMMENDED) }).click();
  await expect(answer).toBeEnabled();

  // The decision log appears as soon as the question exists, showing it open.
  const strip = page.getByTestId("grilling-strip");
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("The grilling plan");
  // 0 answered of 1 open + the 2 the model says are still coming.
  await expect(strip).toContainText("waiting…");
  await expect(strip).toContainText("0/3");


  await answer.click();

  // The card collapses into the recorded decision …
  await expect(page.getByTestId("ask-user-answered")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("ask-user-card")).toHaveCount(0);

  // … and the log now carries the answer.
  await expect(strip).toContainText(RECOMMENDED);
  await expect(strip).not.toContainText("waiting…");
  await expect(strip).toContainText("1/3");

  await expect.poll(async () => {
    const window = await historyCall<{
      events: Array<{ type: string; data: Record<string, unknown> }>;
    }>(page, "readWindow", [sessionId, { kind: "head", limit: 200 }]);
    return {
      resultCount: window.events.filter((event) => event.type === "tool/result").length,
      resumes: window.events.filter((event) => event.type === "turn/resume")
        .map((event) => event.data),
    };
  }, { timeout: 15_000 }).toEqual({
    resultCount: 1,
    resumes: [expect.objectContaining({ turn: 1, step: 1, cause: "response" })],
  });

  // Answering completed the tool call, so the run resumes on its own — nobody
  // pressed send. The continuation is appended to the same assistant message,
  // so the proof is that prose appears next to the answered card (the card
  // itself renders no visible paragraph). Without provider keys the run still
  // starts and surfaces its error instead; either way it moved by itself.
  const resumedProse = page.locator(
    '[data-message-role="assistant"] p:visible',
  );
  await expect
    .poll(
      async () =>
        (await resumedProse.count()) > 0 ||
        (await page.getByText("Something went wrong.").count()) > 0,
      { timeout: 45_000 },
    )
    .toBe(true);
});

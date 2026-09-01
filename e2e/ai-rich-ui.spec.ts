/**
 * Rich chat views: the agent draws a findings list, a click lands in the
 * editor on the right line, and an interactive view resumes the run.
 *
 * Only the model produces these parts, so the spec seeds them into the live
 * `Chat` through `window.__termcoE2E.aiSeedMessages` (the same setter `useChat`
 * writes through) and then drives the card exactly as a user would.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openAiPanel } from "./helpers";

const MESSAGE = "Race condition on resume";

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

async function seedCanonicalInteractiveTurn(page: Page): Promise<string> {
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
    const sessionId = state?.activeSessionId ?? state?.sessions?.[0]?.id;
    if (!sessionId) throw new Error("No active AI session");
    return sessionId;
  });
  const input = {
    view: {
      kind: "cards",
      title: "Canonical fixes",
      items: [{ title: "Keep one open turn" }],
    },
    question: "Apply the canonical fix?",
    actions: [
      { id: "apply", label: "Apply canonical fix", recommended: true },
      { id: "later", label: "Later" },
    ],
  };
  const assistant = {
    id: "canonical-assistant",
    role: "assistant",
    parts: [{
      type: "tool-ask_ui",
      toolCallId: "canonical-ui-call",
      state: "input-available",
      input,
    }],
  };
  await historyCall(page, "append", [sessionId, [
    { type: "turn/start", time: Date.now(), data: { turn: 1, cause: "user" } },
    {
      type: "user/message",
      time: Date.now(),
      data: {
        turn: 1,
        message: { id: "canonical-user", role: "user", parts: [{ type: "text", text: "Show a choice" }] },
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
        requestId: "canonical-request",
        reason: "initial",
        header: {
          selectedModelId: "e2e-model",
          providerRoute: "openai-compatible",
          providerModelId: "e2e-model",
          systemPrompt: "System",
          messages: [{ role: "user", content: "Show a choice" }],
          tools: [{
            name: "ask_ui",
            schema: { type: "object", properties: {} },
            contributor: { pluginId: "ai-tools-ui-native", contributionId: "ui" },
          }],
          activeTools: ["ask_ui"],
          maxSteps: 100,
          approvalPolicy: { mode: "ask" },
        },
      },
    },
    { type: "request/attempt", time: Date.now(), data: { requestId: "canonical-request", attempt: 1 } },
    {
      type: "tool/call",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        requestId: "canonical-request",
        callId: "canonical-ui-call",
        name: "ask_ui",
        rawArguments: JSON.stringify(input),
        parsedInput: input,
        contributor: { pluginId: "ai-tools-ui-native", contributionId: "ui" },
        concurrency: "exclusive",
      },
    },
    {
      type: "assistant/message",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        requestId: "canonical-request",
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
        callIds: ["canonical-ui-call"],
        approvalIds: [],
      },
    },
  ], { durability: "flushed" }]);
  await seed(page, assistant.parts);
  return sessionId;
}

async function seedCanonicalApprovalTurn(page: Page): Promise<string> {
  const sessionId = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __termcoE2E?: { aiSessionState?: () => { sessions?: Array<{ id: string }> } };
      }
    ).__termcoE2E?.aiSessionState?.();
    const id = state?.sessions?.[0]?.id;
    if (!id) throw new Error("No active AI session");
    return id;
  });
  const input = { path: "rejected-e2e.txt", content: "must not be written" };
  const assistant = {
    id: "approval-assistant",
    role: "assistant",
    parts: [{
      type: "tool-write_file",
      toolCallId: "approval-call",
      state: "approval-requested",
      approval: { id: "approval-1" },
      input,
    }],
  };
  const contributor = { pluginId: "ai-tools-files-native", contributionId: "files" };
  await historyCall(page, "append", [sessionId, [
    { type: "turn/start", time: Date.now(), data: { turn: 1, cause: "user" } },
    {
      type: "user/message",
      time: Date.now(),
      data: {
        turn: 1,
        message: { id: "approval-user", role: "user", parts: [{ type: "text", text: "Write a file" }] },
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
        requestId: "approval-request",
        reason: "initial",
        header: {
          selectedModelId: "e2e-model",
          providerRoute: "openai-compatible",
          providerModelId: "e2e-model",
          systemPrompt: "System",
          messages: [{ role: "user", content: "Write a file" }],
          tools: [{ name: "write_file", schema: { type: "object", properties: {} }, contributor }],
          activeTools: ["write_file"],
          maxSteps: 100,
          approvalPolicy: { mode: "ask" },
        },
      },
    },
    { type: "request/attempt", time: Date.now(), data: { requestId: "approval-request", attempt: 1 } },
    {
      type: "tool/call",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        requestId: "approval-request",
        callId: "approval-call",
        name: "write_file",
        rawArguments: JSON.stringify(input),
        parsedInput: input,
        contributor,
        concurrency: "exclusive",
      },
    },
    {
      type: "approval/request",
      time: Date.now(),
      data: {
        approvalId: "approval-1",
        callId: "approval-call",
        policy: { mode: "ask" },
        reason: { kind: "tool-policy" },
      },
    },
    {
      type: "assistant/message",
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        requestId: "approval-request",
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
        callIds: ["approval-call"],
        approvalIds: ["approval-1"],
      },
    },
  ], { durability: "flushed" }]);
  await seed(page, assistant.parts);
  return sessionId;
}

async function seed(page: Page, parts: unknown[]): Promise<void> {
  const ok = await page.evaluate((p) => {
    const hook = (
      window as unknown as {
        __termcoE2E?: { aiSeedMessages: (m: unknown[]) => boolean };
      }
    ).__termcoE2E;
    if (!hook) throw new Error("E2E hook not present");
    return hook.aiSeedMessages([
      { id: "u", role: "user", parts: [{ type: "text", text: "review it" }] },
      { id: "a", role: "assistant", parts: [{ type: "step-start" }, ...p] },
    ]);
  }, parts);
  expect(ok, "no active chat session to seed").toBe(true);
}

test("a findings view opens the file at the right line", async ({ page }) => {
  await openAiPanel(page);
  await seed(page, [
    {
      type: "tool-show_ui",
      toolCallId: "v1",
      state: "output-available",
      input: {
        view: {
          kind: "findings",
          title: "Review",
          items: [
            {
              severity: "error",
              message: MESSAGE,
              detail: "The predicate fires before the output lands.",
              // A file this workspace really has, so the editor can open it.
              ref: { file: "README.md", line: 3 },
            },
          ],
        },
      },
      output: { ok: true },
    },
  ]);

  const card = page.getByTestId("rich-ui-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText(MESSAGE);
  await expect(card).toContainText("README.md:3");
  // It must NOT fall through to the generic tool row.
  await expect(page.getByTestId("tool")).toHaveCount(0);

  await card.getByRole("button", { name: new RegExp(MESSAGE) }).click();

  // The editor opened the file — a new tab carrying its name.
  await expect(
    page.getByRole("tab", { name: /README\.md/ }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("a live view from a running tool renders and settles", async ({ page }) => {
  await openAiPanel(page);
  const live = (done: boolean, label: string) => ({
    type: "data-view",
    id: "sub-1",
    data: {
      view: {
        kind: "tree",
        title: done ? "Subagent finished" : "Subagent running",
        nodes: [{ label: "explorer: grep", depth: 0 }],
      },
      label,
      done,
    },
  });

  await seed(page, [live(false, "step 1")]);
  const card = page.getByTestId("live-view-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toHaveAttribute("data-done", "false");
  await expect(card).toContainText("Subagent running");
  await expect(card).toContainText("step 1");

  // The emitter rewrites the same part id — the card updates in place.
  await seed(page, [live(true, "4 steps · 2s")]);
  await expect(page.getByTestId("live-view-card")).toHaveCount(1);
  await expect(page.getByTestId("live-view-card")).toHaveAttribute(
    "data-done",
    "true",
  );
  await expect(page.getByTestId("live-view-card")).toContainText(
    "Subagent finished",
  );
});

test("an interactive view answers and resumes the run", async ({ page }) => {
  await openAiPanel(page);
  await seedCanonicalInteractiveTurn(page);

  const card = page.getByTestId("rich-ui-card-interactive");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Apply the canonical fix?");
  await expect(card).toContainText("Paused");

  await card.getByRole("button", { name: /Apply canonical fix/ }).click();

  // The card collapses into the recorded decision …
  await expect(
    card.getByRole("button", { name: /Apply canonical fix/ }),
  ).toHaveCount(0, { timeout: 10_000 });
  await expect(card).not.toContainText("Paused");

  // … and the run continues on its own — nobody pressed send. With provider
  // keys that is fresh prose in the same assistant message; without them the
  // run still starts and surfaces its error.
  const prose = page.locator('[data-message-role="assistant"] p:visible');
  await expect
    .poll(
      async () =>
        (await prose.count()) > 0 ||
        (await page.getByText("Something went wrong.").count()) > 0,
      { timeout: 45_000 },
    )
    .toBe(true);
});

test("a canonical interactive turn stays safely paused, then resumes healthy in the same turn", async ({ page }) => {
  await openAiPanel(page);
  const sessionId = await seedCanonicalInteractiveTurn(page);
  const card = page.getByTestId("rich-ui-card-interactive");
  await expect(card).toContainText("Apply the canonical fix?");

  // No response is a durable state, not an error or a repair candidate.
  await page.waitForTimeout(1_000);
  const waiting = await historyCall<{
    repair: { state: string };
    events: Array<{ type: string; data: Record<string, unknown> }>;
  }>(page, "readWindow", [sessionId, { kind: "head", limit: 200 }]);
  expect(waiting.repair.state).toBe("waiting-input");
  expect(waiting.events.filter((event) => event.type === "turn/end")).toHaveLength(0);
  await page.getByTestId("chat-open-trajectory").click();
  await expect(page.getByRole("status")).toContainText("Session is waiting for input");
  await expect(page.getByRole("button", { name: "Repair session for continuation" })).toHaveCount(0);

  await card.getByRole("button", { name: "Apply canonical fix" }).click();

  await expect.poll(async () => {
    const window = await historyCall<{
      repair: { state: string };
      events: Array<{ type: string; data: Record<string, unknown> }>;
    }>(page, "readWindow", [sessionId, { kind: "head", limit: 200 }]);
    const types = window.events.map((event) => event.type);
    return {
      hasResult: types.includes("tool/result"),
      resumes: window.events.filter((event) => event.type === "turn/resume")
        .map((event) => event.data),
    };
  }, { timeout: 15_000 }).toEqual({
    hasResult: true,
    resumes: [expect.objectContaining({ turn: 1, step: 1, cause: "response" })],
  });

  // The placeholder E2E provider may deliberately remain in-flight. Stop is
  // required to terminalize that resumed request without damaging its turn.
  await page.evaluate(async (id) => {
    const seam = (
      window as unknown as {
        __termcoE2E?: { aiStopChat?: (sessionId: string) => Promise<void> };
      }
    ).__termcoE2E;
    if (!seam?.aiStopChat) throw new Error("AI Stop E2E seam is unavailable");
    await seam.aiStopChat(id);
  }, sessionId);

  await expect.poll(async () => {
    const window = await historyCall<{
      repair: { state: string };
      events: Array<{ type: string }>;
    }>(page, "readWindow", [sessionId, { kind: "head", limit: 200 }]);
    return {
      health: window.repair.state,
      ended: window.events.some((event) => event.type === "turn/end"),
    };
  }, { timeout: 15_000 }).toEqual({ health: "healthy", ended: true });
  await expect(page.getByText(/violates (step-balance|single-open-turn|tool-call)/)).toHaveCount(0);
});

test("an unanswered canonical interaction blocks Send and Stop cancels it cleanly", async ({ page }) => {
  await openAiPanel(page);
  const sessionId = await seedCanonicalInteractiveTurn(page);
  const panel = page.getByTestId("ai-panel");
  const card = page.getByTestId("rich-ui-card-interactive");
  await expect(card).toContainText("Paused");

  // A waiting interaction is still an active run. A second user turn must not
  // be offered while the first one owns the session.
  const stop = panel.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
  await stop.click();

  await expect.poll(async () => {
    const window = await historyCall<{
      repair: { state: string };
      events: Array<{ type: string; data: Record<string, unknown> }>;
    }>(page, "readWindow", [sessionId, { kind: "head", limit: 200 }]);
    const result = window.events.find((event) => event.type === "tool/result");
    return {
      health: window.repair.state,
      resultError: result?.data.error,
      resumes: window.events.filter((event) => event.type === "turn/resume")
        .map((event) => event.data),
      ended: window.events.some((event) => event.type === "turn/end"),
    };
  }, { timeout: 15_000 }).toEqual({
    health: "healthy",
    resultError: expect.objectContaining({ code: "USER_CANCELLED" }),
    resumes: [expect.objectContaining({ turn: 1, step: 1, cause: "cancel" })],
    ended: true,
  });
  await expect(panel.getByText("This request was stopped.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(page.getByText(/violates (step-balance|single-open-turn|tool-call)/)).toHaveCount(0);
});

test("manual-mode rejection is canonical before the same turn resumes", async ({ page }) => {
  await openAiPanel(page);
  const sessionId = await seedCanonicalApprovalTurn(page);
  await expect(page.getByText("Review required")).toBeVisible();
  await page.getByRole("button", { name: "Don’t allow" }).click();

  await expect.poll(async () => {
    const window = await historyCall<{
      events: Array<{ type: string; data: Record<string, unknown> }>;
    }>(page, "readWindow", [sessionId, { kind: "head", limit: 200 }]);
    return {
      decisions: window.events.filter((event) => event.type === "approval/decision")
        .map((event) => event.data),
      hasResult: window.events.some((event) => event.type === "tool/result"),
      resumes: window.events.filter((event) => event.type === "turn/resume")
        .map((event) => event.data),
    };
  }, { timeout: 15_000 }).toEqual({
    decisions: [expect.objectContaining({ approvalId: "approval-1", outcome: "rejected" })],
    hasResult: true,
    resumes: [expect.objectContaining({ turn: 1, step: 1, cause: "response" })],
  });

  await page.evaluate(async (id) => {
    const seam = (
      window as unknown as { __termcoE2E?: { aiStopChat?: (sessionId: string) => Promise<void> } }
    ).__termcoE2E;
    if (!seam?.aiStopChat) throw new Error("AI Stop E2E seam is unavailable");
    await seam.aiStopChat(id);
  }, sessionId);
  await expect.poll(async () => {
    const window = await historyCall<{ repair: { state: string } }>(
      page,
      "readWindow",
      [sessionId, { kind: "head", limit: 200 }],
    );
    return window.repair.state;
  }, { timeout: 15_000 }).toBe("healthy");
});

test("manual-mode approval executes once before the same turn continues", async ({ page }) => {
  await openAiPanel(page);
  const sessionId = await seedCanonicalApprovalTurn(page);
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await expect.poll(async () => {
    const window = await historyCall<{
      events: Array<{ type: string; data: Record<string, unknown> }>;
    }>(page, "readWindow", [sessionId, { kind: "head", limit: 200 }]);
    return {
      decisions: window.events.filter((event) => event.type === "approval/decision")
        .map((event) => event.data),
      resultCount: window.events.filter((event) => event.type === "tool/result").length,
      resumes: window.events.filter((event) => event.type === "turn/resume")
        .map((event) => event.data),
    };
  }, { timeout: 15_000 }).toEqual({
    decisions: [expect.objectContaining({ approvalId: "approval-1", outcome: "allowed-once" })],
    resultCount: 1,
    resumes: [expect.objectContaining({ turn: 1, step: 1, cause: "response" })],
  });

  await page.evaluate(async (id) => {
    const seam = (
      window as unknown as { __termcoE2E?: { aiStopChat?: (sessionId: string) => Promise<void> } }
    ).__termcoE2E;
    if (!seam?.aiStopChat) throw new Error("AI Stop E2E seam is unavailable");
    await seam.aiStopChat(id);
  }, sessionId);
  await expect.poll(async () => {
    const window = await historyCall<{ repair: { state: string } }>(
      page,
      "readWindow",
      [sessionId, { kind: "head", limit: 200 }],
    );
    return window.repair.state;
  }, { timeout: 15_000 }).toBe("healthy");
});

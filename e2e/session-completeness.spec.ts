/** End-to-end proof that Chat writes one authoritative current-format session. */
import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  expect,
  seedCustomEndpoint,
  seedWorkspace,
  test as base,
  type Workspace,
} from "./fixtures";
import { openAiPanel } from "./helpers";

const PLACEHOLDER_KEY = "sk-e2e-placeholder-not-a-real-key";
const FINAL_TEXT = "SESSION_OK_842";
const STOP_STREAM_PROMPT = "STOP_STREAM_NOW_417";
const AFTER_STOP_PROMPT = "AFTER_STOP_ANSWER_417";
const AFTER_STOP_TEXT = "STOP_RECOVERED_417";

type Stub = {
  readonly port: number;
  readonly requests: Array<{ raw: string; body: Record<string, unknown> }>;
  readonly stoppedStreams: number;
  readonly close: () => void;
};

function sse(events: readonly unknown[]): string {
  return `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
}

function startStub(): Promise<Stub> {
  const requests: Stub["requests"] = [];
  let completions = 0;
  let stoppedStreams = 0;
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += String(chunk); });
    request.on("end", () => {
      if (!request.url?.includes("/chat/completions")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [] }));
        return;
      }
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push({ raw, body });
      completions += 1;
      const baseChunk = { id: `cmpl-${completions}`, object: "chat.completion.chunk", created: 1, model: "stub-model" };
      if (raw.includes(AFTER_STOP_PROMPT)) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.end(sse([
          { ...baseChunk, choices: [{ index: 0, delta: { role: "assistant", content: AFTER_STOP_TEXT }, finish_reason: null }] },
          { ...baseChunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 } },
        ]));
        return;
      }
      if (raw.includes(STOP_STREAM_PROMPT)) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.write(`data: ${JSON.stringify({
          ...baseChunk,
          choices: [{ index: 0, delta: { role: "assistant", content: "STREAM_STARTED_417" }, finish_reason: null }],
        })}\n\n`);
        const heartbeat = setInterval(() => response.write(": waiting\n\n"), 250);
        response.on("close", () => {
          clearInterval(heartbeat);
          stoppedStreams += 1;
        });
        return;
      }
      const events = completions === 1
        ? [
            { ...baseChunk, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_session_1", type: "function", function: { name: "read_transcript", arguments: '{"id":"nothing-here"}' } }] }, finish_reason: null }] },
            { ...baseChunk, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 } },
          ]
        : [
            { ...baseChunk, choices: [{ index: 0, delta: { role: "assistant", content: FINAL_TEXT }, finish_reason: null }] },
            { ...baseChunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34 } },
          ];
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.end(sse(events));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({
      port: (server.address() as { port: number }).port,
      requests,
      get stoppedStreams() { return stoppedStreams; },
      close: () => server.close(),
    });
  }));
}

const test = base.extend<{ stub: Stub }>({
  stub: async ({}, use) => {
    const stub = await startStub();
    await use(stub);
    stub.close();
  },
  workspace: async ({ stub }, use) => {
    const workspace = seedWorkspace();
    seedCustomEndpoint(workspace, {
      id: "e2e-session",
      name: "E2E Session",
      baseURL: `http://127.0.0.1:${stub.port}/v1`,
      modelId: "stub-model",
      contextLimit: 32_000,
    });
    await use(workspace);
  },
});

type SessionEvent = {
  readonly seq: number;
  readonly time: number;
  readonly type: string;
  readonly data: Record<string, unknown>;
};

async function sessionCall<T>(
  page: Page,
  method: "list" | "readWindow",
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

async function pickModel(page: Page): Promise<void> {
  const panel = page.getByTestId("ai-panel");
  await panel.locator('button[title^="Model:"]').first().click();
  const browser = page.locator("[data-model-browser]");
  await browser.waitFor({ state: "visible" });
  await browser.locator("[data-model-search]").fill("E2E Session");
  await browser.getByRole("menuitem").filter({ hasText: "E2E Session" }).first().click();
}

function persistedSession(workspace: Workspace, sessionId: string): string {
  return readFileSync(join(workspace.userData, "sessions", sessionId, "events.jsonl"), "utf8");
}

test.describe("canonical session completeness", () => {
  test.setTimeout(180_000);

  test("records a gapless full-fidelity turn whose request matches the wire", async ({ page, stub, workspace }) => {
    await openAiPanel(page);
    await pickModel(page);
    const prompt = "Record this exact session prompt.";
    const panel = page.getByTestId("ai-panel");
    const composer = panel.getByPlaceholder("Describe the outcome you want…").first();
    await composer.fill(prompt);
    await composer.press("Enter");
    await expect(panel.getByText(FINAL_TEXT).last()).toBeVisible({ timeout: 60_000 });
    expect(stub.requests).toHaveLength(2);

    let sessionId = "";
    await expect.poll(async () => {
      const list = await sessionCall<{ sessions: Array<{ sessionId: string; backend: string; fidelity: string }> }>(page, "list", [{ limit: 50 }]);
      const session = list.sessions.find((candidate) => candidate.backend === "chat" && candidate.fidelity === "full");
      if (!session) return "missing";
      sessionId = session.sessionId;
      const window = await sessionCall<{ events: SessionEvent[] }>(page, "readWindow", [sessionId, { kind: "head", limit: 1000 }]);
      return window.events.some((event) => event.type === "turn/end") ? "complete" : "open";
    }, { timeout: 20_000 }).toBe("complete");

    const window = await sessionCall<{
      header: { id: string; authority: string; backend: string; fidelity: string };
      events: SessionEvent[];
      repair: { state: string };
    }>(page, "readWindow", [sessionId, { kind: "head", limit: 1000 }]);
    expect(window.header).toMatchObject({ id: sessionId, authority: "v2", backend: "chat", fidelity: "full" });
    expect(window.repair.state).toBe("healthy");
    expect(window.events.map((event) => event.seq)).toEqual(window.events.map((_, index) => index));
    expect(window.events.filter((event) => event.type === "user/message")).toHaveLength(1);
    expect(JSON.stringify(window.events.find((event) => event.type === "user/message")?.data)).toContain(prompt);
    const requestEvents = window.events.filter(
      (event) => event.type === "request/header",
    );
    expect(requestEvents).toHaveLength(2);
    expect(requestEvents.map((event) => event.data.reason)).toEqual([
      "initial",
      "step",
    ]);
    expect(requestEvents.map((event) => event.data.step)).toEqual([1, 2]);
    expect(new Set(requestEvents.map((event) => event.data.requestId)).size).toBe(2);
    expect(window.events.filter((event) => event.type === "assistant/message")).toHaveLength(1);
    const toolCall = window.events.find((event) => event.type === "tool/call");
    const toolResult = window.events.find((event) => event.type === "tool/result");
    expect(toolCall?.data).toMatchObject({
      callId: "call_session_1",
      name: "read_transcript",
      contributor: { pluginId: expect.any(String) },
    });
    expect(toolResult?.data).toMatchObject({
      callId: "call_session_1",
      canonicalOutput: expect.anything(),
    });

    const requests = requestEvents.map((event) => event.data as {
      header: {
        systemPrompt: string;
        messages: unknown[];
        tools: unknown[];
        selectedModelId: string;
        providerModelId: string;
      };
    });
    for (const [index, request] of requests.entries()) {
      expect(request.header.selectedModelId).toContain("e2e-session");
      expect(request.header.providerModelId).toBe("stub-model");
      expect(request.header.tools.length).toBeGreaterThan(0);
      expect(request.header.tools[0]).toMatchObject({
        name: expect.any(String),
        schema: expect.any(Object),
        contributor: { pluginId: expect.any(String) },
      });
      expect(stub.requests[index]?.body.model).toBe(request.header.providerModelId);
      expect(stub.requests[index]?.body.messages).toEqual(
        expect.arrayContaining([{
          role: "system",
          content: request.header.systemPrompt,
        }]),
      );
    }
    expect(JSON.stringify(requests[0]!.header.messages)).toContain(prompt);
    expect(stub.requests[0]!.raw).toContain(prompt);
    expect(JSON.stringify(requests[1]!.header.messages)).toContain("call_session_1");
    expect(stub.requests[1]!.raw).toContain("call_session_1");
    expect(persistedSession(workspace, sessionId)).not.toContain(PLACEHOLDER_KEY);
  });

  test("Stop durably closes the active turn before the next request starts", async ({ page, stub }) => {
    await openAiPanel(page);
    await pickModel(page);
    const panel = page.getByTestId("ai-panel");
    const composer = panel.getByPlaceholder("Describe the outcome you want…").first();
    const stop = panel.getByRole("button", { name: "Stop", exact: true });

    await composer.fill(STOP_STREAM_PROMPT);
    await composer.press("Enter");
    await expect.poll(() => stub.requests.length, { timeout: 30_000 }).toBe(1);
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await stop.click();
    await expect(stop).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => stub.stoppedStreams).toBe(1);

    await composer.fill(AFTER_STOP_PROMPT);
    await composer.press("Enter");
    await expect(panel.getByText(AFTER_STOP_TEXT).last()).toBeVisible({ timeout: 30_000 });
    await expect(stop).toBeHidden({ timeout: 30_000 });
    await expect(panel.getByText(/single-open-turn|turn \d+ is still open/i)).toHaveCount(0);
    expect(stub.requests).toHaveLength(2);

    let sessionId = "";
    let events: SessionEvent[] = [];
    await expect.poll(async () => {
      const list = await sessionCall<{ sessions: Array<{ sessionId: string; backend: string }> }>(
        page,
        "list",
        [{ limit: 50 }],
      );
      sessionId = list.sessions.find((candidate) => candidate.backend === "chat")?.sessionId ?? "";
      if (!sessionId) return [];
      const window = await sessionCall<{ events: SessionEvent[] }>(
        page,
        "readWindow",
        [sessionId, { kind: "head", limit: 1000 }],
      );
      events = window.events;
      return events.filter((event) => event.type === "turn/end").length;
    }, { timeout: 20_000 }).toBe(2);

    expect(events.filter((event) => event.type === "turn/start")).toHaveLength(2);
    expect(events.filter((event) => event.type === "turn/end").map((event) => event.data.reason)).toEqual([
      { kind: "aborted", cause: { kind: "user" } },
      { kind: "completed" },
    ]);
  });
});

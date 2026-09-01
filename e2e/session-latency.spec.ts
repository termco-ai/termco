/** User-facing latency and ordering gates for the canonical Chat session path. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const STREAM_TEXT = "STREAM_VISIBLE_PROMPTLY_902";
const FINAL_TEXT = "CONTROLLED_TOOL_COMPLETE_902";
const TOOL_PROMPT = "RUN_CONTROLLED_TOOL_902";
const COMPLETE_PROMPT = "COMPLETE_HEALTHY_902";
const STOP_PROMPT = "STOP_LATENCY_902";
const TOOL_NAME = "mcp__controlled-side-effect__touch";

type Stub = {
  readonly port: number;
  readonly requests: string[];
  readonly firstChunkAt: number;
  readonly stoppedAt: number;
  readonly close: () => void;
};

function chunk(id: string, delta: Record<string, unknown>, finishReason: string | null = null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: 1,
    model: "latency-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function startStub(): Promise<Stub> {
  const requests: string[] = [];
  let firstChunkAt = 0;
  let stoppedAt = 0;
  let completion = 0;
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (value) => { raw += String(value); });
    request.on("end", () => {
      if (!request.url?.includes("/chat/completions")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [] }));
        return;
      }
      requests.push(raw);
      completion += 1;
      const id = `latency-${completion}`;
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });

      if (raw.includes(STOP_PROMPT)) {
        response.write(chunk(id, { role: "assistant", content: "STOP_STREAM_STARTED_902" }));
        const heartbeat = setInterval(() => response.write(": waiting\n\n"), 100);
        response.on("close", () => {
          clearInterval(heartbeat);
          stoppedAt = Date.now();
        });
        return;
      }

      if (raw.includes(TOOL_PROMPT) && requests.length === 1) {
        firstChunkAt = Date.now();
        response.write(chunk(id, { role: "assistant", content: STREAM_TEXT }));
        setTimeout(() => {
          response.write(chunk(id, {
            tool_calls: [{
              index: 0,
              id: "tool-search-call-902",
              type: "function",
              function: {
                name: "tool_search",
                arguments: JSON.stringify({ query: "controlled side effect touch" }),
              },
            }],
          }));
          response.write(chunk(id, {}, "tool_calls"));
          response.end("data: [DONE]\n\n");
        }, 100);
        return;
      }

      if (raw.includes(TOOL_PROMPT) && requests.length === 2) {
        response.write(chunk(id, {
          role: "assistant",
          tool_calls: [{
            index: 0,
            id: "controlled-call-902",
            type: "function",
            function: { name: TOOL_NAME, arguments: "{}" },
          }],
        }));
        response.write(chunk(id, {}, "tool_calls"));
        response.end("data: [DONE]\n\n");
        return;
      }

      response.write(chunk(id, { role: "assistant", content: FINAL_TEXT }));
      response.write(chunk(id, {}, "stop"));
      response.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    port: (server.address() as { port: number }).port,
    requests,
    get firstChunkAt() { return firstChunkAt; },
    get stoppedAt() { return stoppedAt; },
    close: () => server.close(),
  })));
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
      id: "e2e-latency",
      name: "E2E Latency",
      baseURL: `http://127.0.0.1:${stub.port}/v1`,
      modelId: "latency-model",
      contextLimit: 32_000,
    });
    await use(workspace);
  },
});

const autoRunTest = test.extend({
  workspace: async ({ stub }, use) => {
    const workspace = seedWorkspace();
    seedCustomEndpoint(workspace, {
      id: "e2e-latency",
      name: "E2E Latency",
      baseURL: `http://127.0.0.1:${stub.port}/v1`,
      modelId: "latency-model",
      contextLimit: 32_000,
    });
    const settingsPath = join(workspace.userData, "termco-settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    writeFileSync(settingsPath, JSON.stringify({ ...settings, agentAutoApprove: true }));
    await use(workspace);
  },
});

async function pickModel(page: Page): Promise<void> {
  const panel = page.getByTestId("ai-panel");
  await panel.locator('button[title^="Model:"]').first().click();
  const browser = page.locator("[data-model-browser]");
  await browser.waitFor({ state: "visible" });
  await browser.locator("[data-model-search]").fill("E2E Latency");
  await browser.getByRole("menuitem").filter({ hasText: "E2E Latency" }).first().click();
}

async function addControlledTool(page: Page, workspace: Workspace): Promise<{
  entered: string;
  release: string;
  sideEffect: string;
}> {
  const paths = {
    entered: join(workspace.userData, "controlled-tool-entered"),
    release: join(workspace.userData, "controlled-tool-release"),
    sideEffect: join(workspace.userData, "controlled-tool-side-effect"),
  };
  await page.evaluate((configuration) => window.__termco.capabilityCall({
    consumerPluginId: "ai-chat-native",
    capability: "ai.library",
    method: "addMcpServers",
    args: [[configuration]],
  }), {
    name: "controlled-side-effect",
    command: process.execPath,
    args: [
      join(process.cwd(), "e2e", "fixtures", "mcp-controlled-side-effect.mjs"),
      paths.entered,
      paths.release,
      paths.sideEffect,
    ],
  });
  await expect.poll(() => page.evaluate((name) => {
    const definitions = (window as unknown as {
      __termcoE2E?: { aiToolDefinitions?: () => Record<string, unknown> };
    }).__termcoE2E?.aiToolDefinitions?.();
    return Boolean(definitions?.[name]);
  }, TOOL_NAME)).toBe(true);
  return paths;
}

test.describe("canonical session user-facing latency", () => {
  test.setTimeout(120_000);

  test("streams promptly and exposes a controlled tool before its side effect", async ({ page, stub, workspace }) => {
    await openAiPanel(page);
    await pickModel(page);
    const paths = await addControlledTool(page, workspace);
    const panel = page.getByTestId("ai-panel");
    const composer = panel.getByPlaceholder("Describe the outcome you want…").first();

    await composer.fill(TOOL_PROMPT);
    await composer.press("Enter");
    await expect(panel.getByText(STREAM_TEXT).last()).toBeVisible({ timeout: 10_000 });
    const streamVisibleMs = Date.now() - stub.firstChunkAt;
    expect(stub.firstChunkAt).toBeGreaterThan(0);
    expect(streamVisibleMs, "provider chunk to visible streamed text").toBeLessThan(1_500);

    await expect(panel.getByText(TOOL_NAME, { exact: true })).toBeVisible();
    expect(existsSync(paths.entered), "approval must precede tool-body entry").toBe(false);
    expect(existsSync(paths.sideEffect), "tool side effect must remain gated while its call is visible").toBe(false);
    await panel.getByRole("button", { name: "Approve", exact: true }).click();
    await expect.poll(() => existsSync(paths.entered), { timeout: 15_000 }).toBe(true);
    await expect(panel.getByText(TOOL_NAME, { exact: true })).toBeVisible();
    expect(existsSync(paths.sideEffect), "tool side effect must remain gated while its row is visible").toBe(false);
    writeFileSync(paths.release, "release\n");
    await expect.poll(() => existsSync(paths.sideEffect)).toBe(true);
    await expect.poll(() => stub.requests.length, { timeout: 10_000 }).toBe(3);
    await expect(panel.getByText(FINAL_TEXT).last()).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText("Something went wrong.")).toHaveCount(0);
    await expect(page.getByText(/TOOL_RESULT_MISMATCH|different terminal outcome/i)).toHaveCount(0);
    console.log(`[session-latency] streamed text visible in ${streamVisibleMs}ms`);
  });

  test("a completed session shows no repair banner in Trajectory", async ({ page }) => {
    await openAiPanel(page);
    await pickModel(page);
    const panel = page.getByTestId("ai-panel");
    const composer = panel.getByPlaceholder("Describe the outcome you want…").first();
    await composer.fill(COMPLETE_PROMPT);
    await composer.press("Enter");
    await expect(panel.getByText(FINAL_TEXT).last()).toBeVisible({ timeout: 10_000 });
    await panel.getByTestId("chat-open-trajectory").click();
    const trajectory = page.getByTestId("trajectory-pane");
    await expect(trajectory).toBeVisible();
    await expect(trajectory.getByRole("status")).toHaveCount(0);
    await expect(trajectory.getByRole("alert")).toHaveCount(0);
    await expect(trajectory.getByRole("button", { name: "Repair session for continuation" })).toHaveCount(0);
  });

  test("Stop aborts the provider stream promptly", async ({ page, stub }) => {
    await openAiPanel(page);
    await pickModel(page);
    const panel = page.getByTestId("ai-panel");
    const composer = panel.getByPlaceholder("Describe the outcome you want…").first();
    const stop = panel.getByRole("button", { name: "Stop", exact: true });

    await composer.fill(STOP_PROMPT);
    await composer.press("Enter");
    await expect(panel.getByText("STOP_STREAM_STARTED_902").last()).toBeVisible({ timeout: 10_000 });
    await expect(stop).toBeVisible();
    const clickedAt = Date.now();
    await stop.click();
    await expect(stop).toBeHidden({ timeout: 1_000 });
    await expect.poll(() => stub.stoppedAt, { timeout: 1_000 }).toBeGreaterThan(0);
    const abortMs = stub.stoppedAt - clickedAt;
    expect(abortMs, "Stop click to provider connection abort").toBeLessThan(1_000);
    console.log(`[session-latency] Stop aborted provider stream in ${abortMs}ms`);
  });
});

autoRunTest("auto-run renders a controlled tool before body entry and side effect", async ({ page, stub, workspace }) => {
  autoRunTest.setTimeout(120_000);
  await openAiPanel(page);
  await pickModel(page);
  const paths = await addControlledTool(page, workspace);
  const panel = page.getByTestId("ai-panel");
  await expect(panel.getByRole("button", { name: /Auto-run is ON/ })).toBeVisible();
  const composer = panel.getByPlaceholder("Describe the outcome you want…").first();

  await composer.fill(TOOL_PROMPT);
  await composer.press("Enter");
  await expect(panel.getByText(STREAM_TEXT).last()).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  const toolRow = panel.getByText(TOOL_NAME, { exact: true });
  await toolRow.waitFor({ state: "visible", timeout: 10_000 });
  const presentation = panel.locator(
    '[data-tool-presentation="controlled-call-902"]',
  );
  const presentedAt = Number(
    await presentation.getAttribute("data-tool-presented-at"),
  );
  expect(presentedAt).toBeGreaterThan(0);
  await expect.poll(() => existsSync(paths.entered), { timeout: 10_000 }).toBe(true);
  const enteredAt = Number(readFileSync(paths.entered, "utf8").trim());
  const sideEffectBeforeRelease = existsSync(paths.sideEffect);
  console.log(
    `[session-latency] auto-run tool presented=${presentedAt} body-entered=${enteredAt} delta=${enteredAt - presentedAt}ms side-effect=${sideEffectBeforeRelease}`,
  );
  expect(
    presentedAt,
    `tool row must be painted before auto-run body entry (presented=${presentedAt}, entered=${enteredAt})`,
  ).toBeLessThanOrEqual(enteredAt);
  expect(sideEffectBeforeRelease, "auto-run side effect must remain gated after its row is visible").toBe(false);

  writeFileSync(paths.release, "release\n");
  await expect.poll(() => existsSync(paths.sideEffect)).toBe(true);
  await expect(panel.getByText(FINAL_TEXT).last()).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("Something went wrong.")).toHaveCount(0);
  await expect(page.getByText(/TOOL_RESULT_MISMATCH|different terminal outcome/i)).toHaveCount(0);
  expect(stub.requests).toHaveLength(3);
});

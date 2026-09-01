/** Opt-in sustained Chat-stream CPU regression with Trajectory closed/open. */
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  expect,
  seedCustomEndpoint,
  seedWorkspace,
  test as base,
} from "./fixtures";
import { openAiPanel } from "./helpers";
import {
  collectSamples,
  formatReport,
  mark,
  showAppWindow,
  startSampler,
  summarize,
} from "./lib/perfMetrics";

const CLOSED_PROMPT = "SUSTAINED_STREAM_CLOSED_318";
const OPEN_PROMPT = "SUSTAINED_STREAM_OPEN_318";
const CLOSED_DONE = "SUSTAINED_CLOSED_DONE_318";
const OPEN_DONE = "SUSTAINED_OPEN_DONE_318";
const STREAM_MS = 8_000;
const CHUNK_INTERVAL_MS = 4;
const PERF_OUT = fileURLToPath(new URL("./.perf", import.meta.url));

type StreamStub = {
  readonly port: number;
  readonly requests: string[];
  readonly completedAt: number;
  readonly close: () => void;
};

function streamChunk(id: string, delta: Record<string, unknown>, finishReason: string | null = null) {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: 1,
    model: "sustained-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function startStreamStub(): Promise<StreamStub> {
  const requests: string[] = [];
  let completion = 0;
  let completedAt = 0;
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
      const id = `sustained-${completion}`;
      const open = raw.includes(OPEN_PROMPT);
      const finalText = open ? OPEN_DONE : CLOSED_DONE;
      const chunkPrefix = open ? "open" : "closed";
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write(streamChunk(id, { role: "assistant", content: "Sustained output begins.\n\n" }));
      const startedAt = Date.now();
      let index = 0;
      const timer = setInterval(() => {
        if (Date.now() - startedAt < STREAM_MS) {
          const text = `${chunkPrefix}-token-${index++} ${"streaming ".repeat(6)}`;
          response.write(streamChunk(id, { content: text }));
          return;
        }
        clearInterval(timer);
        response.write(streamChunk(id, { content: `\n\n${finalText}` }));
        response.write(streamChunk(id, {}, "stop"));
        completedAt = Date.now();
        response.end("data: [DONE]\n\n");
      }, CHUNK_INTERVAL_MS);
      response.on("close", () => clearInterval(timer));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    port: (server.address() as { port: number }).port,
    requests,
    get completedAt() { return completedAt; },
    close: () => server.close(),
  })));
}

const test = base.extend<{ streamStub: StreamStub }>({
  streamStub: async ({}, use) => {
    const stub = await startStreamStub();
    await use(stub);
    stub.close();
  },
  workspace: async ({ streamStub }, use) => {
    const workspace = seedWorkspace();
    seedCustomEndpoint(workspace, {
      id: "e2e-sustained",
      name: "E2E Sustained",
      baseURL: `http://127.0.0.1:${streamStub.port}/v1`,
      modelId: "sustained-model",
      contextLimit: 64_000,
    });
    await use(workspace);
  },
});

test.skip(
  !process.env.TERMCO_PERF,
  "sustained stream CPU regression is opt-in: TERMCO_PERF=1 pnpm playwright test e2e/perf-session-stream.spec.ts",
);

async function pickModel(page: Page): Promise<void> {
  const panel = page.getByTestId("ai-panel");
  await panel.locator('button[title^="Model:"]').first().click();
  const browser = page.locator("[data-model-browser]");
  await browser.waitFor({ state: "visible" });
  await browser.locator("[data-model-search]").fill("E2E Sustained");
  await browser.getByRole("menuitem").filter({ hasText: "E2E Sustained" }).first().click();
}

async function resetMainEventLoopDelay(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const state = (globalThis as unknown as {
      __perf?: { eld: { reset(): void } };
    }).__perf;
    state?.eld.reset();
  });
}

async function mainEventLoopDelay(app: ElectronApplication): Promise<{
  p50: number;
  p95: number;
  max: number;
}> {
  return app.evaluate(() => {
    const state = (globalThis as unknown as {
      __perf?: { eld: { percentile(value: number): number; max: number } };
    }).__perf;
    if (!state) return { p50: 0, p95: 0, max: 0 };
    const milliseconds = 1e-6;
    return {
      p50: state.eld.percentile(50) * milliseconds,
      p95: state.eld.percentile(95) * milliseconds,
      max: state.eld.max * milliseconds,
    };
  });
}

async function activeSessionHealth(page: Page): Promise<string> {
  const sessionId = await page.evaluate(() => {
    const state = (window as unknown as {
      __termcoE2E?: { aiSessionState?: () => { activeSessionId?: string | null } };
    }).__termcoE2E?.aiSessionState?.();
    return state?.activeSessionId ?? "";
  });
  expect(sessionId).not.toBe("");
  return page.evaluate((id) => window.__termco.capabilityCall({
    consumerPluginId: "trajectory-native",
    capability: "session.history",
    method: "readWindow",
    args: [id, { kind: "tail", limit: 10 }],
  }).then((window) => (window as { repair: { state: string } }).repair.state), sessionId);
}

test("sustained stream remains responsive with Trajectory closed and open", async ({ app, page, streamStub }) => {
  test.setTimeout(180_000);
  await showAppWindow(app);
  await openAiPanel(page);
  await pickModel(page);
  const panel = page.getByTestId("ai-panel");
  const composer = panel.getByPlaceholder("Describe the outcome you want…").first();
  await startSampler(app, 100);

  await resetMainEventLoopDelay(app);
  await mark(app, "sustained-trajectory-closed:start");
  await composer.fill(CLOSED_PROMPT);
  await composer.press("Enter");
  await expect(panel.getByText(/closed-token-10 streaming/).last()).toBeVisible({ timeout: 3_000 });
  await expect(panel.getByText(CLOSED_DONE)).toHaveCount(0);
  await expect(panel.getByText(CLOSED_DONE).last()).toBeVisible({ timeout: 20_000 });
  expect(Date.now() - streamStub.completedAt, "closed final chunk to visible Chat output").toBeLessThan(1_000);
  await expect.poll(() => activeSessionHealth(page)).toBe("healthy");
  await mark(app, "sustained-trajectory-closed:end");
  const closedDelay = await mainEventLoopDelay(app);

  await panel.getByTestId("chat-open-trajectory").click();
  const trajectory = page.getByTestId("trajectory-pane");
  await expect(trajectory).toBeVisible();
  const trajectoryTotal = async () => {
    const label = await trajectory.getByText(/\d+ \/ \d+ records/).first().textContent();
    return Number(label?.match(/\/ (\d+) records/)?.[1] ?? 0);
  };
  const recordsBeforeOpenStream = await trajectoryTotal();
  await resetMainEventLoopDelay(app);
  await mark(app, "sustained-trajectory-open:start");
  await composer.fill(OPEN_PROMPT);
  await composer.press("Enter");
  await expect(panel.getByText(/open-token-10 streaming/).last()).toBeVisible({ timeout: 3_000 });
  await expect(panel.getByText(OPEN_DONE)).toHaveCount(0);
  await expect.poll(trajectoryTotal, { timeout: 3_000 }).toBeGreaterThan(recordsBeforeOpenStream);
  await expect(panel.getByText(OPEN_DONE).last()).toBeVisible({ timeout: 20_000 });
  expect(Date.now() - streamStub.completedAt, "open final chunk to visible Chat output").toBeLessThan(1_000);
  await expect.poll(() => activeSessionHealth(page)).toBe("healthy");
  await mark(app, "sustained-trajectory-open:end");
  const openDelay = await mainEventLoopDelay(app);

  await expect(panel.getByText("Something went wrong.")).toHaveCount(0);
  await expect(trajectory.getByRole("status")).toHaveCount(0);
  await expect(trajectory.getByRole("alert")).toHaveCount(0);
  expect(streamStub.requests).toHaveLength(2);

  const data = await collectSamples(app);
  const rows = summarize(data);
  console.log(formatReport(rows));
  console.log(`[sustained-stream] main event-loop closed p50=${closedDelay.p50.toFixed(1)}ms p95=${closedDelay.p95.toFixed(1)}ms max=${closedDelay.max.toFixed(1)}ms`);
  console.log(`[sustained-stream] main event-loop open p50=${openDelay.p50.toFixed(1)}ms p95=${openDelay.p95.toFixed(1)}ms max=${openDelay.max.toFixed(1)}ms`);
  mkdirSync(PERF_OUT, { recursive: true });
  writeFileSync(
    join(PERF_OUT, `sustained-stream-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
    JSON.stringify({ rows, eventLoopDelay: { closed: closedDelay, open: openDelay }, data }, null, 2),
  );

  for (const scenario of ["sustained-trajectory-closed", "sustained-trajectory-open"]) {
    const row = rows.find((candidate) => candidate.scenario === scenario);
    expect(row, `${scenario} samples`).toBeTruthy();
    expect(row?.sampleCount ?? 0).toBeGreaterThanOrEqual(60);
    expect(row?.byType.Browser?.avg ?? 100, `${scenario} main CPU`).toBeLessThan(6);
    expect(row?.byType.Tab?.avg ?? 100, `${scenario} renderer CPU`).toBeLessThan(12);
  }
  expect(closedDelay.p95, "Trajectory-closed main event-loop p95").toBeLessThan(50);
  expect(openDelay.p95, "Trajectory-open main event-loop p95").toBeLessThan(50);
  expect(closedDelay.max, "Trajectory-closed main event-loop max").toBeLessThan(250);
  expect(openDelay.max, "Trajectory-open main event-loop max").toBeLessThan(250);
});

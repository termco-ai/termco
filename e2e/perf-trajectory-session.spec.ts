/** Opt-in main/renderer idle-CPU regression with Trajectory closed and open. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, MOD, test } from "./fixtures";
import {
  collectSamples,
  formatReport,
  mark,
  showAppWindow,
  startSampler,
  summarize,
} from "./lib/perfMetrics";

const SESSION_ID = "e2e-trajectory-perf-session";
const PERF_OUT = fileURLToPath(new URL("./.perf", import.meta.url));

test.skip(
  !process.env.TERMCO_PERF,
  "trajectory CPU regression is opt-in: TERMCO_PERF=1 pnpm playwright test e2e/perf-trajectory-session.spec.ts",
);

async function historyWrite(page: Page, method: "create" | "append", args: readonly unknown[]) {
  await page.evaluate(([selectedMethod, selectedArgs]) => window.__termco.capabilityCall({
    consumerPluginId: "trajectory-native",
    capability: "session.history",
    method: selectedMethod,
    args: [...selectedArgs],
  }), [method, args] as const);
}

async function seedHealthySession(page: Page): Promise<void> {
  const time = Date.now();
  await historyWrite(page, "create", [{
    header: {
      formatVersion: 2,
      id: SESSION_ID,
      createdAt: time,
      authority: "v2",
      backend: "chat",
      fidelity: "full",
      rigId: "default",
    },
    seed: [{ type: "session/title", time, data: { title: "Trajectory CPU", source: "user" } }],
    durability: "flushed",
  }]);
  await historyWrite(page, "append", [SESSION_ID, [
    { type: "turn/start", time, data: { turn: 1, cause: "user" } },
    { type: "user/message", time, data: { turn: 1, message: { id: "cpu-user", role: "user", parts: [{ type: "text", text: "Measure idle CPU" }] }, source: "human" }, surfaceOp: { op: "append" } },
    { type: "step/start", time, data: { turn: 1, step: 1 } },
    { type: "request/header", time, data: { turn: 1, step: 1, requestId: "cpu-request", reason: "initial", header: { selectedModelId: "cpu-model", providerRoute: "test", providerModelId: "cpu-model", maxOutputTokens: 64, systemPrompt: "System", messages: [{ role: "user", content: "Measure idle CPU" }], tools: [], activeTools: [], maxSteps: 1, approvalPolicy: { mode: "ask" } } } },
    { type: "request/attempt", time, data: { requestId: "cpu-request", attempt: 1 } },
    { type: "assistant/message", time, data: { turn: 1, step: 1, requestId: "cpu-request", message: { id: "cpu-assistant", role: "assistant", parts: [{ type: "text", text: "Idle" }] }, finishReason: "stop" }, surfaceOp: { op: "append" } },
    { type: "step/end", time, data: { turn: 1, step: 1, reason: "completed" } },
    { type: "turn/end", time, data: { turn: 1, reason: { kind: "completed" } } },
  ], { durability: "flushed" }]);
}

test("Trajectory closed/open stays below the established main/renderer CPU bounds", async ({ app, page }) => {
  test.setTimeout(120_000);
  await showAppWindow(app);
  await seedHealthySession(page);
  await page.waitForTimeout(2_000);
  await startSampler(app);

  await mark(app, "trajectory-closed:start");
  await page.waitForTimeout(10_000);
  await mark(app, "trajectory-closed:end");

  await page.keyboard.press(`${MOD}+p`);
  const command = page.getByRole("dialog").first();
  await page.keyboard.type("Open sessions");
  await command.getByRole("option", { name: "Open sessions" }).click();
  const row = page.getByTestId("trajectory-session-row").filter({ hasText: "Trajectory CPU" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open" }).click();
  await expect(page.getByTestId("trajectory-pane")).toBeVisible();
  await page.waitForTimeout(2_000);

  await mark(app, "trajectory-open:start");
  await page.waitForTimeout(10_000);
  await mark(app, "trajectory-open:end");

  const data = await collectSamples(app);
  const rows = summarize(data);
  console.log(formatReport(rows));
  mkdirSync(PERF_OUT, { recursive: true });
  writeFileSync(
    join(PERF_OUT, `trajectory-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
    JSON.stringify({ rows, data }, null, 2),
  );

  for (const scenario of ["trajectory-closed", "trajectory-open"]) {
    const row = rows.find((candidate) => candidate.scenario === scenario);
    expect(row, `${scenario} samples`).toBeTruthy();
    expect(row?.sampleCount ?? 0).toBeGreaterThanOrEqual(30);
    expect(row?.byType.Browser?.avg ?? 100, `${scenario} main CPU`).toBeLessThan(6);
    expect(row?.byType.Tab?.avg ?? 100, `${scenario} renderer CPU`).toBeLessThan(12);
  }
});

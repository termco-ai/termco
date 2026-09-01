/** Semantic Trajectory UI and canonical fork/search flow. */
import type { Page } from "@playwright/test";
import { expect, MOD, test } from "./fixtures";

const SESSION_ID = "e2e-trajectory-session";
const NEEDLE = "SEMANTIC_NEEDLE_4711";

async function historyRead<T>(
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

async function historyWrite<T>(page: Page, method: "create" | "append", args: readonly unknown[]): Promise<T> {
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

async function seedSession(page: Page): Promise<void> {
  await historyWrite(page, "create", [{
    header: {
      formatVersion: 2,
      id: SESSION_ID,
      createdAt: 1_700_000_000_000,
      authority: "v2",
      backend: "chat",
      fidelity: "full",
      rigId: "default",
    },
    seed: [{ type: "session/title", time: 1_700_000_000_000, data: { title: "Trajectory E2E", source: "user" } }],
    durability: "flushed",
  }]);
  await historyWrite(page, "append", [SESSION_ID, [
    { type: "turn/start", time: 1_700_000_000_001, data: { turn: 1, cause: "user" } },
    { type: "user/message", time: 1_700_000_000_002, data: { turn: 1, message: { id: "u1", role: "user", parts: [{ type: "text", text: NEEDLE }] }, source: "human" }, surfaceOp: { op: "append" } },
    { type: "step/start", time: 1_700_000_000_003, data: { turn: 1, step: 1 } },
    { type: "request/header", time: 1_700_000_000_004, data: { turn: 1, step: 1, requestId: "request-1", reason: "initial", header: { selectedModelId: "test-model", providerRoute: "test", providerModelId: "test-model", maxOutputTokens: 4096, systemPrompt: "System", messages: [{ role: "user", content: NEEDLE }], tools: [{ name: "calculator", schema: { type: "object", properties: {} }, contributor: { pluginId: "trajectory-native", fidelity: "full", contributionId: "e2e-calculator" } }], activeTools: ["calculator"], maxSteps: 4, approvalPolicy: { mode: "ask" } } } },
    { type: "request/attempt", time: 1_700_000_000_005, data: { requestId: "request-1", attempt: 1 } },
    { type: "assistant/message", time: 1_700_000_000_006, data: { turn: 1, step: 1, requestId: "request-1", message: { id: "a1", role: "assistant", parts: [{ type: "text", text: "Done" }] }, finishReason: "stop" }, surfaceOp: { op: "append" } },
    { type: "step/end", time: 1_700_000_000_007, data: { turn: 1, step: 1, reason: "completed" } },
    { type: "turn/end", time: 1_700_000_000_008, data: { turn: 1, reason: { kind: "completed" } } },
  ], { durability: "flushed" }]);
}

async function runCommand(page: Page, title: string): Promise<void> {
  await page.keyboard.press(`${MOD}+p`);
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await page.keyboard.type(title);
  const option = dialog.getByRole("option", { name: title }).first();
  await expect(option).toBeVisible();
  await option.click();
}

test.describe("Trajectory current-format UI", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("lists, inspects, filters, and forks a semantic session", async ({ page }) => {
    await runCommand(page, "Open sessions");
    const row = page.getByTestId("trajectory-session-row").filter({ hasText: "Trajectory E2E" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Open" }).click();
    await expect(page.getByTestId("trajectory-fidelity")).toHaveText("full");
    const records = page.getByTestId("trajectory-record-row");
    await expect(records).toHaveCount(10);

    await records.filter({ hasText: "request" }).first().click();
    const inspector = page.getByTestId("trajectory-inspector");
    await expect(inspector).toContainText("4096 max output tokens");
    await expect(inspector).toContainText("calculator");

    await page.getByTestId("trajectory-chip-requests").click();
    await expect(page.locator('[data-testid="trajectory-record-row"][data-record-kind="request"]')).toHaveCount(0);
    await page.getByTestId("trajectory-chip-requests").click();

    const last = records.last();
    await last.getByLabel("Record actions").click();
    await page.getByRole("menuitem", { name: "Fork from here" }).click();
    const forkDialog = page.getByTestId("trajectory-fork-dialog");
    await expect(forkDialog).toContainText("safe boundary");
    await forkDialog.getByTestId("trajectory-fork-confirm").click();

    await expect.poll(async () => {
      const pageResult = await historyRead<{ sessions: Array<{ sessionId: string; parentSessionId?: string }> }>(page, "list", [{ limit: 50 }]);
      return pageResult.sessions.filter((session) => session.parentSessionId === SESSION_ID).length;
    }).toBe(1);
    const parent = await historyRead<{ events: unknown[] }>(page, "readWindow", [SESSION_ID, { kind: "head", limit: 100 }]);
    expect(parent.events).toHaveLength(9);
  });

  test("semantic search opens the exact session event", async ({ page }) => {
    await runCommand(page, "Search sessions…");
    const dialog = page.getByTestId("trajectory-search-dialog");
    await dialog.getByTestId("trajectory-search-input").fill(NEEDLE);
    const hit = dialog.getByTestId("trajectory-search-hit").first();
    await expect(hit).toBeVisible();
    const recordId = await hit.getAttribute("data-record-id");
    expect(recordId).toBeTruthy();
    await hit.click();
    await expect(page.getByTestId("trajectory-pane")).toBeVisible();
    await expect(page.locator(`[data-testid="trajectory-record-row"][data-record-id="${recordId}"][data-selected="true"]`)).toBeVisible();
  });
});

/**
 * App-level verification of the agent-session-history CPU behavior — the
 * reported "~16% CPU while history is loading". Launches the real app with an
 * isolated fake home directory, seeds
 * realistic transcripts including one large "active" one, opens the Agents
 * panel (which triggers the history scan), and measures per-process CPU while
 * a fake CLI appends to the active transcript every 400ms — the live-writer
 * situation that used to force a full re-parse per watcher event.
 *
 * Opt-in: TERMCO_PERF=1 pnpm playwright test e2e/perf-agent-history.spec.ts
 */
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectSamples,
  formatReport,
  mark,
  showAppWindow,
  startSampler,
  summarize,
} from "./lib/perfMetrics";

const MAIN = fileURLToPath(
  new URL("../dist-electron/main/index.cjs", import.meta.url),
);
const PERF_OUT = fileURLToPath(new URL("./.perf", import.meta.url));

const SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function row(i: number, sessionId: string, cwd: string): string {
  return `${JSON.stringify({
    type: i % 2 ? "assistant" : "user",
    sessionId,
    cwd,
    message: {
      role: i % 2 ? "assistant" : "user",
      content: [{ type: "text", text: `row ${i} ${"x".repeat(900)}` }],
    },
  })}\n`;
}

/** Fake HOME with 10 projects × 2 modest sessions + one ~15MB active one. */
function seedHome(): { home: string; activeFile: string } {
  const home = mkdtempSync(join(tmpdir(), "termco-agent-hist-home-"));
  const projects = join(home, ".claude", "projects");
  for (let p = 0; p < 10; p++) {
    const cwd = `/work/project-${p}`;
    const dir = join(projects, cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(dir, { recursive: true });
    for (let s = 0; s < 2; s++) {
      const id = `${p}0000000-1111-2222-3333-44444444444${s}`;
      const lines: string[] = [];
      for (let i = 0; i < 400; i++) lines.push(row(i, id, cwd));
      writeFileSync(join(dir, `${id}.jsonl`), lines.join(""));
    }
  }
  // The "active" session a live CLI keeps appending to (~30MB).
  const activeDir = join(projects, "-work-active");
  mkdirSync(activeDir, { recursive: true });
  const activeFile = join(activeDir, `${SID}.jsonl`);
  const big: string[] = [];
  for (let i = 0; i < 30_000; i++) big.push(row(i, SID, "/work/active"));
  writeFileSync(activeFile, big.join(""));
  return { home, activeFile };
}

type Fx = {
  app: ElectronApplication;
  page: Page;
  seeded: { home: string; activeFile: string };
};

const test = base.extend<Fx>({
  seeded: async ({}, use) => {
    await use(seedHome());
  },
  app: async ({ seeded }, use) => {
    const ws = mkdtempSync(join(tmpdir(), "termco-agent-hist-ws-"));
    writeFileSync(join(ws, "README.md"), "# ws\n");
    const userData = mkdtempSync(join(tmpdir(), "termco-agent-hist-ud-"));
    writeFileSync(
      join(userData, "secrets.json"),
      JSON.stringify({ "termco-ai::openai-api-key": "sk-e2e-placeholder" }),
      { mode: 0o600 },
    );
    const app = await electron.launch({
      args: [MAIN, ws],
      env: {
        ...process.env,
        HOME: seeded.home,
        TERMCO_USER_DATA: userData,
        TERMCO_E2E: "1",
        TERMCO_MCP_PORT: "0",
        VITE_DEV_SERVER_URL: "",
      },
    });
    await startSampler(app);
    await use(app);
    await app.close().catch(() => {});
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await showAppWindow(app);
    await page.getByTestId("sidebar").waitFor({ state: "visible", timeout: 30_000 });
    await use(page);
  },
});

test.skip(
  !process.env.TERMCO_PERF,
  "perf verification is opt-in: TERMCO_PERF=1 pnpm playwright test e2e/perf-agent-history.spec.ts",
);

test("agent history: cold load + live-writer CPU", async ({
  app,
  page,
  seeded,
}) => {
  test.setTimeout(300_000);
  await page.waitForTimeout(3_000);

  // --- open the Agents panel → triggers the history scan ("Loading history…") ---
  await mark(app, "agent-history-cold-open:start");
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "agents", exact: true }).first().click();
  // The roster shows a History section once the scan lands.
  await expect(page.getByText(/History · \d+/).first()).toBeVisible({
    timeout: 60_000,
  });
  await mark(app, "agent-history-cold-open:end");

  // Enter the Session-History view — it is the surface that live-refreshes on
  // every watcher event (the roster lists history only once per mount).
  await page.getByRole("button", { name: "View all" }).first().click();
  await expect(page.getByPlaceholder(/Search/i).first())
    .toBeVisible({ timeout: 15_000 })
    .catch(() => {});

  // --- settle ---
  await page.waitForTimeout(3_000);

  // --- live writer: a ~20KB burst every 1.6s for 30s while the panel is open
  // (a real CLI appends per message/tool-result with thinking pauses — the
  // pauses are what let chokidar's awaitWriteFinish (400ms) + the watcher
  // debounce (800ms) fire one refresh per burst). Pre-fix each refresh
  // re-parsed the whole 30MB transcript. ---
  await mark(app, "agent-history-live-writer:start");
  const writerEnd = Date.now() + 30_000;
  let i = 30_000;
  while (Date.now() < writerEnd) {
    let burst = "";
    for (let k = 0; k < 20; k++) burst += row(i++, SID, "/work/active");
    appendFileSync(seeded.activeFile, burst);
    await page.waitForTimeout(1_600);
  }
  await page.waitForTimeout(2_000);
  await mark(app, "agent-history-live-writer:end");

  // --- same writer with the AI dock CLOSED (no history consumer) ---
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await page.waitForTimeout(1_000);
  await mark(app, "agent-history-writer-dock-closed:start");
  const writer2End = Date.now() + 20_000;
  while (Date.now() < writer2End) {
    let burst = "";
    for (let k = 0; k < 20; k++) burst += row(i++, SID, "/work/active");
    appendFileSync(seeded.activeFile, burst);
    await page.waitForTimeout(1_600);
  }
  await page.waitForTimeout(2_000);
  await mark(app, "agent-history-writer-dock-closed:end");

  const data = await collectSamples(app);
  const rows = summarize(data);
  console.log(formatReport(rows));

  mkdirSync(PERF_OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    join(PERF_OUT, `agent-history-${stamp}.json`),
    JSON.stringify({ rows, data }, null, 2),
  );

  // Soft regression bound: the live-writer window must not keep a core busy.
  const live = rows.find((r) => r.scenario === "agent-history-live-writer");
  expect(live).toBeTruthy();
  expect(live?.totalAvg ?? 100).toBeLessThan(12);
});

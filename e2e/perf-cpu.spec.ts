/**
 * CPU/memory baseline for the LOCAL rig: launches the real built Electron app
 * against a large seeded git repo (1200 commits) and measures per-process CPU
 * (app.getAppMetrics) across realistic scenarios — startup, idle, history
 * loading, full history pagination, view switching, terminal use, and
 * idle-after-visits. Prints a report and writes JSON to e2e/.perf/.
 *
 * Opt-in (long-running): TERMCO_PERF=1 pnpm playwright test e2e/perf-cpu.spec.ts
 */
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectSamples,
  formatReport,
  mark,
  sampleChildTree,
  scrollHistoryToBottom,
  showAppWindow,
  startSampler,
  summarize,
} from "./lib/perfMetrics";

const MAIN = fileURLToPath(
  new URL("../dist-electron/main/index.cjs", import.meta.url),
);
const PERF_OUT = fileURLToPath(new URL("./.perf", import.meta.url));

const COMMITS = 1200;

/**
 * Seed (once, cached across runs) a repo with enough commits that history
 * pagination is realistic: 1200 commits, ~80 files, two merged branches so the
 * graph has lanes. Real file edits every 10th commit; the rest --allow-empty.
 */
export function seedPerfRepo(): string {
  const base = join(tmpdir(), `termco-perf-repo-v2-${COMMITS}`);
  const doneMarker = join(base, ".perf-seed-done");
  if (existsSync(doneMarker)) return base;
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: base,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "Perf Seed",
        GIT_AUTHOR_EMAIL: "perf@termco.dev",
        GIT_COMMITTER_NAME: "Perf Seed",
        GIT_COMMITTER_EMAIL: "perf@termco.dev",
      },
      stdio: "ignore",
    });
  writeFileSync(join(base, "README.md"), "# Perf workspace\n");
  writeFileSync(join(base, "notes.txt"), "line one\n");
  mkdirSync(join(base, "src"));
  for (let i = 0; i < 80; i++) {
    writeFileSync(
      join(base, "src", `mod${String(i).padStart(2, "0")}.ts`),
      `export const value${i} = ${i};\n`,
    );
  }
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "initial commit");
  for (let i = 1; i < COMMITS; i++) {
    if (i % 10 === 0) {
      writeFileSync(
        join(base, "src", `mod${String(i % 80).padStart(2, "0")}.ts`),
        `export const value${i % 80} = ${i};\n// rev ${i}\n`,
      );
      git("add", "-A");
      git("commit", "-q", "-m", `feat: revision ${i}`);
    } else {
      git("commit", "-q", "--allow-empty", "-m", `chore: tick ${i}`);
    }
    // Two feature branches merged along the way → graph lanes exist.
    if (i === 400 || i === 800) {
      git("checkout", "-q", "-b", `feature-${i}`);
      writeFileSync(join(base, `feature-${i}.md`), `feature ${i}\n`);
      git("add", "-A");
      git("commit", "-q", "-m", `feat: branch work ${i}`);
      git("checkout", "-q", "main");
      git("merge", "-q", "--no-ff", "-m", `merge: feature-${i}`, `feature-${i}`);
    }
  }
  // One dirty file so source-control has content.
  writeFileSync(join(base, "notes.txt"), "line one\nline two (uncommitted)\n");
  writeFileSync(doneMarker, "1");
  return base;
}

type Fx = { app: ElectronApplication; page: Page; repo: string };

const test = base.extend<Fx>({
  repo: async ({}, use) => {
    await use(seedPerfRepo());
  },
  app: async ({ repo }, use) => {
    const userData = mkdtempSync(join(tmpdir(), "termco-perf-ud-"));
    writeFileSync(
      join(userData, "secrets.json"),
      JSON.stringify({ "termco-ai::openai-api-key": "sk-e2e-placeholder" }),
      { mode: 0o600 },
    );
    const app = await electron.launch({
      args: [MAIN, repo],
      env: {
        ...process.env,
        TERMCO_USER_DATA: userData,
        TERMCO_E2E: "1",
        TERMCO_MCP_PORT: "0",
        VITE_DEV_SERVER_URL: "",
      },
    });
    // Attach the sampler as early as possible so startup is (mostly) covered.
    await startSampler(app);
    await mark(app, "startup:start");
    await use(app);
    await app.close().catch(() => {});
  },
  page: async ({ app }, use) => {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    // Hidden windows are render-throttled by Chromium and would understate
    // renderer/GPU CPU — show the window for realistic numbers.
    await showAppWindow(app);
    await page.getByTestId("sidebar").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 30_000 });
    await use(page);
  },
});

test.skip(
  !process.env.TERMCO_PERF,
  "perf baseline is opt-in: TERMCO_PERF=1 pnpm playwright test e2e/perf-cpu.spec.ts",
);

async function idle(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

test("local rig CPU baseline across scenarios", async ({ app, page, repo }) => {
  test.setTimeout(600_000);
  const rail = (name: string) =>
    page.getByRole("button", { name, exact: true }).first();

  // --- startup settles ---
  await mark(app, "startup:end");
  await mark(app, "idle-fresh:start");
  await idle(page, 20_000);
  await mark(app, "idle-fresh:end");

  // --- history open (the reported ~16% spike scenario) ---
  await mark(app, "history-open:start");
  await page.getByRole("button", { name: "Source Control" }).first().click();
  await expect(
    page.getByRole("button", { name: /Commit Graph/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await expect(page.getByText("initial commit").or(page.getByText(/chore: tick/).first()).first())
    .toBeVisible({ timeout: 20_000 });
  await mark(app, "history-open:end");

  // --- full pagination traversal: scroll until "End of history" ---
  await mark(app, "history-paginate-all:start");
  for (let i = 0; i < 200; i++) {
    const done = await page
      .getByText("End of history")
      .isVisible()
      .catch(() => false);
    if (done) break;
    const scrolled = await scrollHistoryToBottom(page);
    expect(scrolled, "history scroll container found").toBe(true);
    await page.waitForTimeout(350);
  }
  await expect(page.getByText("End of history")).toBeVisible({ timeout: 30_000 });
  await mark(app, "history-paginate-all:end");

  // --- history idle: leaks/timers left behind by a fully-loaded list ---
  await mark(app, "history-idle:start");
  await idle(page, 15_000);
  await mark(app, "history-idle:end");

  // --- scroll back through the loaded list (pure render/virtualizer cost) ---
  await mark(app, "history-scrollback:start");
  await page.evaluate(async () => {
    const scrollables = Array.from(document.querySelectorAll("div")).filter(
      (el) =>
        el.scrollHeight > el.clientHeight + 100 &&
        /auto|scroll/.test(getComputedStyle(el).overflowY),
    );
    scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
    const el = scrollables[0];
    if (!el) return;
    for (let y = el.scrollHeight; y >= 0; y -= 2000) {
      el.scrollTop = y;
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  await mark(app, "history-scrollback:end");

  // --- view cycle through every sidebar surface ---
  await mark(app, "view-cycle:start");
  for (const view of [
    "Search in files",
    "Containers",
    "Ports",
    "Adopt agent config",
    "Files",
    "Source Control",
    "Files",
  ]) {
    await rail(view).click();
    await page.waitForTimeout(600);
  }
  await mark(app, "view-cycle:end");

  // --- editor open ---
  await mark(app, "editor-open:start");
  await rail("Files").click();
  await page
    .getByRole("button", { name: "README.md", exact: true })
    .first()
    .click();
  await page.waitForTimeout(1_500);
  await mark(app, "editor-open:end");

  // --- terminal: new tab + one command ---
  await mark(app, "terminal-run:start");
  await page.keyboard.press("Meta+Shift+t");
  await page.waitForTimeout(1_000);
  await page.keyboard.type("echo perf-probe && ls", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2_000);
  await mark(app, "terminal-run:end");

  // --- AI dock open (no model call) ---
  await mark(app, "ai-dock-open:start");
  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await page.waitForTimeout(1_500);
  await mark(app, "ai-dock-open:end");

  // --- idle after all views visited: background work from inactive views ---
  await mark(app, "idle-after-visits:start");
  await idle(page, 30_000);
  await mark(app, "idle-after-visits:end");

  // --- blurred window idle ---
  await mark(app, "idle-blurred:start");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.blur();
  });
  await idle(page, 15_000);
  await mark(app, "idle-blurred:end");

  // --- child processes snapshot (git/ssh/pty — invisible to getAppMetrics) ---
  const rootPid = await app.evaluate(() => process.pid);
  const children = await sampleChildTree(rootPid);

  const data = await collectSamples(app);
  const rows = summarize(data);
  console.log(formatReport(rows));
  console.log(
    `main-process cumulative CPU: ${data.mainCpuSeconds.toFixed(1)}s; event-loop delay p50=${data.eventLoopDelayMs.p50.toFixed(1)}ms p95=${data.eventLoopDelayMs.p95.toFixed(1)}ms max=${data.eventLoopDelayMs.max.toFixed(0)}ms`,
  );
  console.log("child tree (ps snapshot):");
  for (const c of children) {
    console.log(
      `  pid=${c.pid} cpu=${c.cpu}% rss=${(c.rssKb / 1024).toFixed(0)}MB ${c.command.slice(0, 120)}`,
    );
  }

  mkdirSync(PERF_OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(
    join(PERF_OUT, `local-${stamp}.json`),
    JSON.stringify({ repo, rows, data, children }, null, 2),
  );

  expect(rows.length).toBeGreaterThan(5);
});

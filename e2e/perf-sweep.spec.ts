/**
 * Whole-app performance sweep. Drives every major view/switch the way a user
 * would click through the app, and measures — per step — the wall time until the
 * target content is visible AND the worst main-thread block (longtask > 50ms)
 * that fired during the step. Anything that blocks the main thread noticeably is
 * what "the whole app feels laggy / loads slowly" actually looks like.
 *
 * This is an instrumentation spec: it prints a ranked report to stdout and only
 * fails on an egregious main-thread block, so it surfaces slow views rather than
 * pinning an exact budget.
 */
import { expect, test } from "./fixtures";
import { openAiPanel } from "./helpers";

type Longtask = { start: number; duration: number };

async function installLongtaskObserver(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __lt: Longtask[] };
    w.__lt = [];
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          w.__lt.push({ start: e.startTime, duration: e.duration });
        }
      });
      obs.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask unsupported — report will just show 0s.
    }
  });
}

async function now(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

async function longtasksSince(
  page: import("@playwright/test").Page,
  since: number,
): Promise<Longtask[]> {
  return page.evaluate((s) => {
    const w = window as unknown as { __lt: Longtask[] };
    return w.__lt.filter((t) => t.start >= s);
  }, since);
}

type StepResult = {
  label: string;
  wallMs: number;
  maxBlockMs: number;
  blockCount: number;
  ok: boolean;
};

test("performance sweep: click through every view and measure load/block time", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await expect(page.getByLabel("Workspace tools")).toBeVisible({
    timeout: 30_000,
  });
  await installLongtaskObserver(page);
  // Let the initial boot settle so we measure steady-state switches, not startup.
  await page.waitForTimeout(1500);

  const results: StepResult[] = [];

  async function step(
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const t0 = await now(page);
    const wall0 = Date.now();
    let ok = true;
    try {
      await action();
    } catch {
      ok = false;
    }
    const wallMs = Date.now() - wall0;
    // Give any deferred render/longtask a moment to land, then read blocks.
    await page.waitForTimeout(150);
    const blocks = await longtasksSince(page, t0);
    const maxBlockMs = blocks.reduce((m, b) => Math.max(m, b.duration), 0);
    results.push({
      label,
      wallMs,
      maxBlockMs: Math.round(maxBlockMs),
      blockCount: blocks.length,
      ok,
    });
  }

  const rail = (name: string) =>
    page.getByRole("button", { name, exact: true }).first();

  // --- Sidebar views ---
  await step("sidebar: Source Control", async () => {
    await rail("Source Control").click();
    await expect(
      page.getByRole("button", { name: /Commit Graph/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
  await step("sidebar: Search in files", async () => {
    await rail("Search in files").click();
    await expect(page.getByLabel("Search file contents")).toBeVisible({
      timeout: 15_000,
    });
  });
  await step("sidebar: Containers", async () => {
    await rail("Containers").click();
    await expect(page.getByLabel("Workspace tools")).toBeVisible();
  });
  await step("sidebar: Ports", async () => {
    await rail("Ports").click();
    await expect(page.getByLabel("Workspace tools")).toBeVisible();
  });
  await step("sidebar: Adopt agent config", async () => {
    await rail("Adopt agent config").click();
    await expect(page.getByLabel("Workspace tools")).toBeVisible();
  });
  await step("sidebar: Files (explorer)", async () => {
    await rail("Files").click();
    await expect(page.getByRole("button", { name: "README.md", exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  // --- Open files (editor mount) ---
  await step("open notes.txt (editor)", async () => {
    await page
      .getByRole("button", { name: "notes.txt", exact: true })
      .first()
      .click();
    await expect(page.locator(".cm-editor").first()).toBeVisible({
      timeout: 15_000,
    });
  });
  await step("open src/index.ts (editor)", async () => {
    // Expand src if needed, then open.
    const src = page.getByRole("button", { name: "src", exact: true }).first();
    if (await src.isVisible().catch(() => false)) await src.click();
    await page
      .getByRole("button", { name: "index.ts", exact: true })
      .first()
      .click();
    await expect(page.locator(".cm-editor").first()).toBeVisible({
      timeout: 15_000,
    });
  });
  await step("open README.md (markdown preview)", async () => {
    await page
      .getByRole("button", { name: "README.md", exact: true })
      .first()
      .click();
    await expect(page.getByText(/Hello world from the workspace/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  // --- AI dock + its modes ---
  await step("open AI dock (chat)", async () => {
    await openAiPanel(page);
  });
  const mode = (m: string) =>
    page.getByRole("button", { name: m, exact: true }).first();
  await step("dock mode: agents", async () => {
    await mode("agents").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
  });
  // Separate the perceived latency: how fast does the agents panel show its OWN
  // content/spinner? (The click-wall above can include Playwright stability
  // waits that a user never feels.) Measure time to first agents content.
  await step("dock: agents content visible", async () => {
    await expect(
      page.getByRole("button", { name: "Connect an external agent" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
  await step("dock mode: workflows", async () => {
    await mode("workflows").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
  });
  await step("dock mode: chat", async () => {
    await mode("chat").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
  });

  // --- Command palette overlay ---
  await step("command palette open", async () => {
    await page.keyboard.press("Meta+p");
    await expect(page.getByRole("dialog").first()).toBeVisible({
      timeout: 10_000,
    });
  });
  await step("command palette close", async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  // --- New terminal tab ---
  await step("new terminal tab", async () => {
    await page.keyboard.press("Meta+Shift+t");
    await page.waitForTimeout(400);
  });

  // --- Terminal typing burst (keystroke-rate re-render probe) ---
  // The app-root audit flagged that `tabs` is component-local useState, so
  // OSC-7 cwd updates (fired when the shell re-emits its prompt after each
  // command) could re-render the whole App tree. Drive real shell activity and
  // watch for main-thread blocks accumulating.
  await step("terminal: type a long command", async () => {
    const term = page.locator(".xterm-screen, .xterm").first();
    if (await term.isVisible().catch(() => false)) await term.click();
    // A long line of keystrokes — pure typing, no OSC-7 yet.
    await page.keyboard.type(
      "echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      { delay: 8 },
    );
    await page.waitForTimeout(200);
  });
  await step("terminal: run 8 cd commands (OSC-7 burst)", async () => {
    // Each `cd` makes the shell re-emit its prompt → OSC-7 → setLeafCwd. Eight
    // in a row is the worst realistic cwd-churn a user produces.
    await page.keyboard.press("Enter");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.type(i % 2 === 0 ? "cd /tmp" : "cd ~", { delay: 5 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(300);
  });

  // --- Re-visit source control (warm) to compare cold vs warm ---
  await step("sidebar: Source Control (warm)", async () => {
    await rail("Source Control").click();
    await expect(
      page.getByRole("button", { name: /Commit Graph/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // --- Report ---
  const sorted = [...results].sort((a, b) => b.maxBlockMs - a.maxBlockMs);
  const lines = [
    "",
    "=== PERF SWEEP REPORT (sorted by worst main-thread block) ===",
    "  block(ms)  wall(ms)  #blocks  ok   step",
    ...sorted.map(
      (r) =>
        `  ${String(r.maxBlockMs).padStart(8)}  ${String(r.wallMs).padStart(8)}  ${String(r.blockCount).padStart(7)}  ${r.ok ? "✓" : "✗"}    ${r.label}`,
    ),
    "=============================================================",
    "",
  ];
  console.log(lines.join("\n"));

  // Every step must have found its target.
  for (const r of results) {
    expect(r.ok, `step "${r.label}" completed`).toBe(true);
  }
  // No single switch should wedge the main thread for close to a second.
  const worst = sorted[0];
  expect(
    worst.maxBlockMs,
    `worst main-thread block was "${worst.label}" at ${worst.maxBlockMs}ms`,
  ).toBeLessThan(1000);
});

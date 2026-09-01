/**
 * CPU/memory sampling for perf specs, measured inside the REAL Electron main
 * process via `app.getAppMetrics()` (per-process CPU% + working-set) plus
 * `process.getCPUUsage()` and an event-loop-delay monitor for the main process.
 *
 * Usage:
 *   await startSampler(app);            // begins 250ms sampling in the main process
 *   await mark(app, "history:start");   // timestamps a scenario boundary
 *   ... drive the UI ...
 *   await mark(app, "history:end");
 *   const data = await collectSamples(app);
 *   const rows = summarize(data);       // per-scenario per-process avg/peak
 *
 * `getAppMetrics()` covers Chromium processes only (Browser/Tab/GPU/Utility) —
 * spawned children (git, ssh, node-pty shells) are NOT included. Use
 * `sampleChildTree()` for an OS-level snapshot of those.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ElectronApplication } from "@playwright/test";

const execFileP = promisify(execFile);

export type ProcSample = {
  pid: number;
  type: string;
  /** Utility process service name when present (e.g. network.mojom.NetworkService). */
  name: string;
  /** CPU% of one core used since the previous sample. */
  cpu: number;
  /** Working set in KB. */
  memKb: number;
};

export type Sample = { t: number; procs: ProcSample[] };
export type Mark = { t: number; label: string };

export type SamplerData = {
  samples: Sample[];
  marks: Mark[];
  /** Cumulative main-process CPU (user+system, seconds) at collect time. */
  mainCpuSeconds: number;
  /** Main-process event-loop delay percentiles over the run (ms). */
  eventLoopDelayMs: { p50: number; p95: number; max: number };
};

declare global {
  // eslint-disable-next-line no-var
  var __perf:
    | {
        samples: Sample[];
        marks: Mark[];
        timer: ReturnType<typeof setInterval>;
        eld: { percentile(p: number): number; max: number; disable(): void };
      }
    | undefined;
}

/**
 * TERMCO_E2E suppresses win.show(), but hidden windows get Chromium's
 * render throttling — CPU numbers there UNDERSTATE real rendering cost.
 * Perf specs call this to make the window visible again so compositing,
 * rAF, and paint all run like they do for a real user.
 */
export async function showAppWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isVisible()) win.show();
  });
}

export async function startSampler(
  app: ElectronApplication,
  intervalMs = 250,
): Promise<void> {
  await app.evaluate(({ app: eApp }, interval) => {
    // Dynamic `import()` is unavailable in the evaluate sandbox; Node 22's
    // process.getBuiltinModule works everywhere including this eval context.
    const { monitorEventLoopDelay } = (
      process as unknown as {
        getBuiltinModule: (m: string) => typeof import("node:perf_hooks");
      }
    ).getBuiltinModule("node:perf_hooks");
    const g = globalThis as typeof globalThis & { __perf?: unknown };
    const eld = monitorEventLoopDelay({ resolution: 20 });
    eld.enable();
    // Prime the delta so the first real sample is a proper interval.
    eApp.getAppMetrics();
    const state = {
      samples: [] as Sample[],
      marks: [] as Mark[],
      eld,
      timer: setInterval(() => {
        const procs = eApp.getAppMetrics().map((m) => ({
          pid: m.pid,
          type: m.type,
          name:
            (m as { name?: string }).name ??
            (m as { serviceName?: string }).serviceName ??
            "",
          cpu: m.cpu.percentCPUUsage,
          memKb: m.memory?.workingSetSize ?? 0,
        }));
        state.samples.push({ t: Date.now(), procs });
      }, interval),
    };
    g.__perf = state;
  }, intervalMs);
}

export async function mark(
  app: ElectronApplication,
  label: string,
): Promise<void> {
  await app.evaluate(({ app: _ }, l) => {
    const g = globalThis as typeof globalThis & {
      __perf?: { marks: Mark[] };
    };
    g.__perf?.marks.push({ t: Date.now(), label: l });
  }, label);
}

export async function collectSamples(
  app: ElectronApplication,
): Promise<SamplerData> {
  return app.evaluate(({ app: _ }) => {
    const g = globalThis as typeof globalThis & {
      __perf?: {
        samples: Sample[];
        marks: Mark[];
        timer: ReturnType<typeof setInterval>;
        eld: {
          percentile(p: number): number;
          max: number;
          disable(): void;
        };
      };
    };
    const s = g.__perf;
    if (!s) {
      return {
        samples: [],
        marks: [],
        mainCpuSeconds: 0,
        eventLoopDelayMs: { p50: 0, p95: 0, max: 0 },
      };
    }
    clearInterval(s.timer);
    s.eld.disable();
    // Node's process.cpuUsage() (µs) — Electron's getCPUUsage() has a
    // different shape (percentCPUUsage) and no cumulative totals.
    const cpu = process.cpuUsage();
    const ns = 1e-6; // eld reports nanoseconds
    return {
      samples: s.samples,
      marks: s.marks,
      mainCpuSeconds: (cpu.user + cpu.system) / 1e6,
      eventLoopDelayMs: {
        p50: s.eld.percentile(50) * ns,
        p95: s.eld.percentile(95) * ns,
        max: s.eld.max * ns,
      },
    };
  });
}

export type ScenarioRow = {
  scenario: string;
  durationMs: number;
  /** Sum over all Chromium processes. */
  totalAvg: number;
  totalPeak: number;
  /** By process type: Browser (main), Tab (renderer), GPU, Utility. */
  byType: Record<string, { avg: number; peak: number }>;
  memStartMb: number;
  memEndMb: number;
  sampleCount: number;
};

/**
 * Slice samples between `<label>:start` / `<label>:end` mark pairs and compute
 * per-type average and peak CPU. Marks with the same label may repeat; each
 * pair becomes `label#i`.
 */
export function summarize(data: SamplerData): ScenarioRow[] {
  const rows: ScenarioRow[] = [];
  const starts = new Map<string, number[]>();
  const pairs: { label: string; t0: number; t1: number }[] = [];
  for (const m of data.marks) {
    if (m.label.endsWith(":start")) {
      const l = m.label.slice(0, -":start".length);
      const arr = starts.get(l) ?? [];
      arr.push(m.t);
      starts.set(l, arr);
    } else if (m.label.endsWith(":end")) {
      const l = m.label.slice(0, -":end".length);
      const arr = starts.get(l) ?? [];
      const t0 = arr.pop();
      if (t0 !== undefined) pairs.push({ label: l, t0, t1: m.t });
    }
  }
  const seen = new Map<string, number>();
  for (const p of pairs.sort((a, b) => a.t0 - b.t0)) {
    const n = (seen.get(p.label) ?? 0) + 1;
    seen.set(p.label, n);
    const label = n > 1 ? `${p.label}#${n}` : p.label;
    const slice = data.samples.filter((s) => s.t > p.t0 && s.t <= p.t1);
    const byType: Record<string, { avg: number; peak: number; sum: number }> =
      {};
    let totalAvgAcc = 0;
    let totalPeak = 0;
    for (const s of slice) {
      let totalThis = 0;
      const perType = new Map<string, number>();
      for (const proc of s.procs) {
        totalThis += proc.cpu;
        perType.set(proc.type, (perType.get(proc.type) ?? 0) + proc.cpu);
      }
      totalAvgAcc += totalThis;
      totalPeak = Math.max(totalPeak, totalThis);
      for (const [type, cpu] of perType) {
        const e = byType[type] ?? { avg: 0, peak: 0, sum: 0 };
        e.sum += cpu;
        e.peak = Math.max(e.peak, cpu);
        byType[type] = e;
      }
    }
    for (const e of Object.values(byType)) {
      e.avg = slice.length ? e.sum / slice.length : 0;
    }
    const memOf = (s: Sample | undefined) =>
      s ? s.procs.reduce((acc, proc) => acc + proc.memKb, 0) / 1024 : 0;
    rows.push({
      scenario: label,
      durationMs: p.t1 - p.t0,
      totalAvg: slice.length ? totalAvgAcc / slice.length : 0,
      totalPeak,
      byType: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [
          k,
          { avg: v.avg, peak: v.peak },
        ]),
      ),
      memStartMb: memOf(slice[0]),
      memEndMb: memOf(slice[slice.length - 1]),
      sampleCount: slice.length,
    });
  }
  return rows;
}

export function formatReport(rows: ScenarioRow[]): string {
  const lines = [
    "",
    "=== CPU BASELINE (percent of one core; total = sum of all Chromium processes) ===",
    "  scenario                                dur(s)  avg%   peak%  main-avg  rend-avg  gpu-avg  util-avg  memΔ(MB)  n",
  ];
  for (const r of rows) {
    const t = (k: string) => r.byType[k]?.avg ?? 0;
    lines.push(
      `  ${r.scenario.padEnd(38)}  ${(r.durationMs / 1000).toFixed(1).padStart(5)}  ${r.totalAvg
        .toFixed(1)
        .padStart(5)}  ${r.totalPeak.toFixed(1).padStart(5)}  ${t("Browser")
        .toFixed(1)
        .padStart(8)}  ${t("Tab").toFixed(1).padStart(8)}  ${t("GPU")
        .toFixed(1)
        .padStart(7)}  ${t("Utility").toFixed(1).padStart(8)}  ${(
        r.memEndMb - r.memStartMb
      )
        .toFixed(1)
        .padStart(8)}  ${r.sampleCount}`,
    );
  }
  lines.push(
    "==============================================================================",
    "",
  );
  return lines.join("\n");
}

/**
 * Scroll the git-history list to its bottom. Finds a virtualised row (inline
 * translateY transform) and walks up to its scrollable ancestor — immune to
 * styling/class changes and to other overflow containers on the page.
 */
export async function scrollHistoryToBottom(
  page: import("@playwright/test").Page,
): Promise<boolean> {
  return page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll("div")).filter(
      (el) =>
        el.scrollHeight > el.clientHeight + 100 &&
        /auto|scroll/.test(getComputedStyle(el).overflowY),
    );
    // The virtualised commit list towers over every other scroll container
    // (rowCount * 40px), so the tallest scrollable is the history list.
    scrollables.sort((a, b) => b.scrollHeight - a.scrollHeight);
    const el = scrollables[0];
    if (!el) return false;
    el.scrollTop = el.scrollHeight;
    return true;
  });
}

export type ChildProc = {
  pid: number;
  ppid: number;
  cpu: number;
  rssKb: number;
  command: string;
};

/**
 * OS-level snapshot of every descendant of the Electron root pid — catches
 * git/ssh/node-pty children that `getAppMetrics()` cannot see. macOS `ps`
 * %cpu is a decaying average, so treat it as sustained-load evidence only.
 */
export async function sampleChildTree(rootPid: number): Promise<ChildProc[]> {
  const { stdout } = await execFileP("ps", [
    "-Ao",
    "pid=,ppid=,pcpu=,rss=,command=",
  ]);
  const all: ChildProc[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    all.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      rssKb: Number(m[4]),
      command: m[5],
    });
  }
  const keep = new Set<number>([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) {
      if (keep.has(p.ppid) && !keep.has(p.pid)) {
        keep.add(p.pid);
        grew = true;
      }
    }
  }
  return all.filter((p) => keep.has(p.pid));
}

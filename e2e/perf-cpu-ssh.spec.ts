/**
 * CPU/memory baseline for the SSH rig (opendoc-v2): seeds a commit-heavy repo
 * under /tmp on the remote host (idempotent, non-destructive), creates an SSH
 * rig through the production seam (`window.__termcoE2E.rigCreateSsh`), and
 * measures connect, remote explorer/history/pagination, terminal, idle, and
 * disconnect. Requires `ssh opendoc-v2` to work non-interactively.
 *
 * Opt-in: TERMCO_PERF=1 pnpm playwright test e2e/perf-cpu-ssh.spec.ts
 */
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

const SSH_HOST = process.env.TERMCO_PERF_SSH_HOST ?? "opendoc-v2";
const REMOTE_REPO = "/tmp/termco-perf-repo-v1";
const REMOTE_COMMITS = 400;

/** Idempotent remote seed: a 400-commit repo under /tmp. Never touches
 * anything outside REMOTE_REPO. */
async function seedRemoteRepo(): Promise<void> {
  const script = `
set -e
command -v git >/dev/null || { echo "NO_GIT"; exit 3; }
if [ -f ${REMOTE_REPO}/.perf-seed-done ]; then echo SEEDED; exit 0; fi
rm -rf ${REMOTE_REPO}
mkdir -p ${REMOTE_REPO}/src
cd ${REMOTE_REPO}
git init -q -b main
git config user.email perf@termco.dev
git config user.name "Perf Seed"
echo "# Remote perf workspace" > README.md
echo "line one" > notes.txt
for i in $(seq 0 39); do echo "export const value$i = $i;" > src/mod$i.ts; done
git add -A
git commit -q -m "initial commit"
i=1
while [ $i -lt ${REMOTE_COMMITS} ]; do
  if [ $((i % 10)) -eq 0 ]; then
    echo "// rev $i" >> src/mod$((i % 40)).ts
    git add -A
    git commit -q -m "feat: revision $i"
  else
    git commit -q --allow-empty -m "chore: tick $i"
  fi
  i=$((i + 1))
done
echo "line two (uncommitted)" >> notes.txt
touch ${REMOTE_REPO}/.perf-seed-done
echo SEEDED
`;
  const stdout = execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SSH_HOST, "bash", "-s"],
    { input: script, timeout: 300_000, encoding: "utf8" },
  );
  if (!stdout.includes("SEEDED")) throw new Error(`remote seed failed: ${stdout}`);
}

function seedLocalWorkspace(): { dir: string; userData: string } {
  const dir = mkdtempSync(join(tmpdir(), "termco-perf-ssh-ws-"));
  const userData = mkdtempSync(join(tmpdir(), "termco-perf-ssh-ud-"));
  writeFileSync(join(dir, "README.md"), "# local\n");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@termco.dev");
  git("config", "user.name", "Termco E2E");
  git("add", "-A");
  git("commit", "-q", "-m", "initial commit");
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, "secrets.json"),
    JSON.stringify({ "termco-ai::openai-api-key": "sk-e2e-placeholder" }),
    { mode: 0o600 },
  );
  return { dir, userData };
}

type Fx = { app: ElectronApplication; page: Page };

const test = base.extend<Fx>({
  app: async ({}, use) => {
    const ws = seedLocalWorkspace();
    const app = await electron.launch({
      args: [MAIN, ws.dir],
      env: {
        ...process.env,
        TERMCO_USER_DATA: ws.userData,
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
    await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 30_000 });
    await use(page);
  },
});

test.skip(
  !process.env.TERMCO_PERF,
  "perf baseline is opt-in: TERMCO_PERF=1 pnpm playwright test e2e/perf-cpu-ssh.spec.ts",
);

test("ssh rig (opendoc-v2) CPU baseline across scenarios", async ({
  app,
  page,
}) => {
  test.setTimeout(600_000);
  await seedRemoteRepo();
  const rail = (name: string) =>
    page.getByRole("button", { name, exact: true }).first();

  // Boot settle before touching SSH so connect cost is isolated.
  await page.waitForTimeout(3_000);

  // --- connect: create the SSH rig via the production seam ---
  await mark(app, "ssh-connect:start");
  await page.evaluate(
    ({ host, root }) => {
      const e2e = (
        window as unknown as {
          __termcoE2E?: { rigCreateSsh: (c: string, r: string) => string };
        }
      ).__termcoE2E;
      if (!e2e) throw new Error("__termcoE2E missing");
      e2e.rigCreateSsh(host, root);
    },
    { host: SSH_HOST, root: REMOTE_REPO },
  );
  // The production new-ssh-rig flow opens a terminal tab in the new rig; the
  // seam doesn't, and surfaces derive their context from the ACTIVE TAB — so
  // open one (it spawns `ssh -tt … cd <root>` because the rig env is active).
  await page.keyboard.press("Meta+Shift+t");
  // Remote explorer listing proves connect + server deploy + fs round-trip.
  await expect(
    page.getByRole("button", { name: "README.md", exact: true }).first(),
  ).toBeVisible({ timeout: 90_000 });
  // Give the remote shell prompt a moment (sshd + rcfile + integration).
  await page.waitForTimeout(8_000);
  await mark(app, "ssh-connect:end");

  // --- idle on connected SSH rig (state-hub push traffic: ports 3s / containers 10s) ---
  await mark(app, "ssh-idle:start");
  await page.waitForTimeout(25_000);
  await mark(app, "ssh-idle:end");

  // --- remote git history open ---
  await mark(app, "ssh-history-open:start");
  await page.getByRole("button", { name: "Source Control" }).first().click();
  await expect(
    page.getByRole("button", { name: /Commit Graph/ }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await expect(page.getByText(/chore: tick/).first()).toBeVisible({
    timeout: 45_000,
  });
  await mark(app, "ssh-history-open:end");

  // --- remote pagination traversal to the end ---
  await mark(app, "ssh-history-paginate-all:start");
  for (let i = 0; i < 120; i++) {
    const done = await page
      .getByText("End of history")
      .isVisible()
      .catch(() => false);
    if (done) break;
    const scrolled = await scrollHistoryToBottom(page);
    expect(scrolled, "history scroll container found").toBe(true);
    await page.waitForTimeout(500);
  }
  await expect(page.getByText("End of history")).toBeVisible({
    timeout: 60_000,
  });
  await mark(app, "ssh-history-paginate-all:end");

  // --- remote terminal: ssh -tt PTY + one command ---
  await mark(app, "ssh-terminal-run:start");
  await page.keyboard.press("Meta+Shift+t");
  await page.waitForTimeout(4_000);
  await page.keyboard.type("echo perf-remote && ls", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3_000);
  await mark(app, "ssh-terminal-run:end");

  // --- files view + idle after all remote views visited ---
  await rail("Files").click();
  await page.waitForTimeout(1_000);
  await mark(app, "ssh-idle-after-visits:start");
  await page.waitForTimeout(30_000);
  await mark(app, "ssh-idle-after-visits:end");

  // --- child processes (ssh master, node server side effects show up here) ---
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
    join(PERF_OUT, `ssh-${stamp}.json`),
    JSON.stringify({ host: SSH_HOST, remoteRepo: REMOTE_REPO, rows, data, children }, null, 2),
  );

  expect(rows.length).toBeGreaterThan(4);
});

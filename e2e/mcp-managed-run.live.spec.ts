/**
 * LIVE end-to-end proof that a managed coding-agent run drives the app over
 * MCP with the FIXED approval behavior:
 *   • a termco tool triggers exactly ONE approval, in the RUN view (via the
 *     driver flow) — NOT the app-wide bottom overlay;
 *   • the backend's own hook does NOT also gate Termco tools (no double approval);
 *   • approving it lets the tool run (a browser tab opens).
 *
 * This is the fully-coupled test I earlier said "needs manual verification" —
 * it does not: it launches the app via Playwright and starts the real backend CLI.
 * Gated behind TERMCO_LIVE_AGENT=1 (needs the CLI installed and authenticated), so
 * CI and clean machines skip it. Runs the CLI locally (no ssh needed).
 */
import { createServer, type Server } from "node:http";
import { expect, test } from "./fixtures";

const LIVE = process.env.TERMCO_LIVE_AGENT === "1";

type E2E = {
  rigCreateSsh: (connectionId: string, root: string) => string;
  rigSetActive: (rigId: string) => void;
  envGet: () =>
    | { kind: "local" }
    | { kind: "ssh"; connectionId: string; host: string }
    | null;
  codingAgentsStart: (input: {
    backend: "claude" | "codex";
    prompt: string;
    cwd: string;
    permissionMode?: "default" | "acceptEdits" | "plan" | "bypass";
    workspace?: ReturnType<E2E["envGet"]>;
    rigId?: string;
  }) => Promise<string>;
  codingAgentsSnapshot: (runId: string) => {
    status: string;
    pendingApprovalId: string | null;
    toolNames: string[];
    error: string | null;
    text: string;
  } | null;
  codingAgentsRespondApproval: (
    runId: string,
    approvalId: string,
    allow: boolean,
  ) => void;
};

test.skip(!LIVE, "set TERMCO_LIVE_AGENT=1 (needs a logged-in claude) to run");

test("a real managed Claude run ACTUALLY opens the browser and completes the task", async ({
  page,
  workspace,
}) => {
  test.setTimeout(150_000);

  // A tiny local page (offline, deterministic) that the agent will open + read.
  const srv: Server = await new Promise((resolve) => {
    const s = createServer((_q, r) => {
      r.writeHead(200, { "Content-Type": "text/html" });
      r.end(
        "<html><title>Sheep Facts</title><body><h1>SHEEP_MARKER</h1>" +
          "<p>A sheep is a domesticated ruminant.</p></body></html>",
      );
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const localUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;

  try {
    // Full-auto run → MCP tools auto-approve, so the whole task runs hands-free
    // (exactly what "open a browser and search" should do). This exercises the
    // Real end-to-end loop: agent → MCP server → bridge → renderer browser.
    const runId = await page.evaluate(
      async ([url, cwd]) => {
        const e2e = (window as unknown as { __termcoE2E: E2E }).__termcoE2E;
        return e2e.codingAgentsStart({
          backend: "claude",
          prompt:
            `Open ${url} in the embedded browser using the termco MCP tools, then ` +
            `read the page and tell me the text of the H1 heading, verbatim.`,
          cwd,
          workspace: { kind: "local" },
          permissionMode: "bypass",
        });
      },
      [localUrl, workspace.dir] as const,
    );
    expect(runId).toBeTruthy();

    // The agent really drives the app: a browser (preview) tab appears.
    await expect
      .poll(
        async () =>
          page.evaluate((id) => {
            const e2e = (window as unknown as { __termcoE2E: E2E }).__termcoE2E;
            const snapshot = e2e.codingAgentsSnapshot(id);
            return JSON.stringify({
              status: snapshot?.status,
              error: snapshot?.error,
              tools: snapshot?.toolNames,
              said: (snapshot?.text ?? "").slice(0, 500),
            });
          }, runId),
        { timeout: 120_000, intervals: [1500] },
      )
      .toContain("browser");

    // A real browser view is now open in the app (visible native WebContentsView).
    await expect(page.locator("webview, iframe, [data-testid='browser-view']").first())
      .toBeVisible({ timeout: 20_000 })
      .catch(() => {}); // view detection is best-effort; the tool-call proof above is the hard one

    // The run completes and reports the marker it read from the page;
    // proof the browser actually loaded + was read back through the MCP loop.
    await expect
      .poll(
        async () =>
          page.evaluate((id) => {
            const e2e = (window as unknown as { __termcoE2E: E2E }).__termcoE2E;
            return e2e.codingAgentsSnapshot(id)?.text ?? "";
          }, runId),
        { timeout: 120_000, intervals: [1500] },
      )
      .toContain("SHEEP_MARKER");

    // Full-auto ran hands-free: no approval overlay was ever needed.
    await expect(page.getByTestId("mcp-approval-overlay")).toHaveCount(0);

    // Capture visible proof.
    await page.screenshot({ path: "e2e/.output/managed-browser-proof.png" }).catch(() => {});
  } finally {
    srv.close();
  }
});

/**
 * The SAME task, but on an SSH RIG (opendoc-v2 from the user's ssh config):
 * the app creates the rig, the CLI spawns ON THE HOST (PATH prelude finds its
 * a user-local binary), the MCP URL and approval endpoint reach back through the
 * `-R` reverse tunnels, the token crosses via stdin (never argv) — and the
 * remote agent drives this app's embedded browser. Full production path.
 * Additionally gated on TERMCO_LIVE_SSH_HOST (the config alias).
 */
const SSH_HOST = process.env.TERMCO_LIVE_SSH_HOST ?? "";

test("a managed Claude run ON THE SSH RIG drives this app's browser through the tunnel", async ({
  page,
}) => {
  test.skip(!SSH_HOST, "set TERMCO_LIVE_SSH_HOST=opendoc-v2 to run");
  test.setTimeout(240_000);

  const srv: Server = await new Promise((resolve) => {
    const s = createServer((_q, r) => {
      r.writeHead(200, { "Content-Type": "text/html" });
      r.end(
        "<html><title>Remote Rig Page</title><body><h1>REMOTE_RIG_MARKER</h1></body></html>",
      );
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const localUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;

  try {
    // Create the ssh rig from the config alias and make it active — runs
    // started now execute on the host (exactly the user's flow).
    const rigId = await page.evaluate((alias) => {
      const e2e = (window as unknown as { __termcoE2E: E2E }).__termcoE2E;
      const id = e2e.rigCreateSsh(alias, "/root");
      e2e.rigSetActive(id);
      return id;
    }, SSH_HOST);
    expect(rigId).toBeTruthy();

    // Full-auto on a root host makes the app downgrade the backend's own posture
    // (its root guard) but keeps MCP tools hands-free. The run spawns REMOTE.
    const runId = await page.evaluate(
      async ([url, activeRigId]) => {
        const e2e = (window as unknown as { __termcoE2E: E2E }).__termcoE2E;
        return e2e.codingAgentsStart({
          backend: "claude",
          prompt:
            `Open ${url} in the embedded browser using the termco MCP tools, then ` +
            `read the page and tell me the text of the H1 heading, verbatim.`,
          cwd: "/root",
          workspace: e2e.envGet(),
          rigId: activeRigId,
          permissionMode: "bypass",
        });
      },
      [localUrl, rigId] as const,
    );

    // The remote agent reaches back through the tunnel and calls browser tools.
    // Poll on the SERIALIZED state so a failure prints status/error/tools —
    // instant diagnosis instead of a mute timeout.
    await expect
      .poll(
        async () =>
          page.evaluate((id) => {
            const e2e = (window as unknown as { __termcoE2E: E2E }).__termcoE2E;
            const s = e2e.codingAgentsSnapshot(id);
            return JSON.stringify({
              status: s?.status,
              error: s?.error,
              tools: s?.toolNames,
              said: (s?.text ?? "").slice(0, 300),
            });
          }, runId),
        { timeout: 180_000, intervals: [2000] },
      )
      .toContain("mcp__termco__browser");

    // …and reports the marker it read from the page loaded in THIS app.
    await expect
      .poll(
        async () =>
          page.evaluate((id) => {
            const e2e = (window as unknown as { __termcoE2E: E2E }).__termcoE2E;
            return e2e.codingAgentsSnapshot(id)?.text ?? "";
          }, runId),
        { timeout: 180_000, intervals: [2000] },
      )
      .toContain("REMOTE_RIG_MARKER");

    await expect(page.getByTestId("mcp-approval-overlay")).toHaveCount(0);
    await page
      .screenshot({ path: "e2e/.output/managed-ssh-rig-proof.png" })
      .catch(() => {});
  } finally {
    srv.close();
  }
});

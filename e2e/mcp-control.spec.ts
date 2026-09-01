/**
 * MCP control server E2E: a simulated EXTERNAL agent (raw streamable-HTTP
 * client) drives the running app and we assert BOTH the MCP response and the
 * visible effect. No model / login needed — fully deterministic.
 *
 * The app is launched with TERMCO_MCP_PORT=0 (ephemeral) to avoid worker port
 * collisions; the test reads the actual URL back from the app.
 */
import { createServer, type Server } from "node:http";
import { expect, test } from "./fixtures";
import { openAiConversation } from "./helpers";
import { McpAgent } from "./lib/mcpAgent";

/** Call the public MCP-server capability as a declared renderer consumer. */
async function mcpInvoke<T>(page: import("@playwright/test").Page, cmd: string, payload: unknown): Promise<T> {
  return page.evaluate(
    ([c, p]) =>
      window.__termco.capabilityCall({
        consumerPluginId: "mcp-tool-bridge",
        capability: "mcp.server",
        method: "invoke",
        args: [c as string, p],
        caller: true,
      }),
    [cmd, payload] as const,
  ) as Promise<T>;
}

async function serverUrl(page: import("@playwright/test").Page): Promise<string> {
  // The server starts with the app; poll briefly in case it's still binding.
  for (let i = 0; i < 20; i++) {
    const s = await mcpInvoke<{ url: string | null }>(page, "mcp_server_status", {});
    if (s.url) return s.url;
    await page.waitForTimeout(150);
  }
  throw new Error("MCP server never reported a URL");
}

/** Create a user token and return its plaintext. */
async function makeToken(
  page: import("@playwright/test").Page,
  opts: { autoApprove?: boolean; rigId?: string | null } = {},
): Promise<string> {
  const r = await mcpInvoke<{ token: string }>(page, "mcp_token_create", {
    label: "e2e-agent",
    autoApprove: opts.autoApprove ?? false,
    rigId: opts.rigId ?? null,
  });
  return r.token;
}

/** Wait for the renderer to have synced at least one rig, and return it. */
async function firstRig(
  page: import("@playwright/test").Page,
): Promise<{ id: string; name: string; root: string }> {
  for (let i = 0; i < 40; i++) {
    const rigs = await mcpInvoke<Array<{ id: string; name: string; root: string }>>(
      page,
      "mcp_rigs_list",
      {},
    );
    if (rigs.length > 0) return rigs[0];
    await page.waitForTimeout(150);
  }
  throw new Error("no rig was ever synced to the MCP server");
}

/** A rig-pinned token + initialized agent — the common setup for tool calls
 * (avoids select_rig path/symlink fragility; select_rig is tested separately). */
async function pinnedAgent(
  page: import("@playwright/test").Page,
  url: string,
  opts: { autoApprove?: boolean } = {},
): Promise<McpAgent> {
  const rig = await firstRig(page);
  const token = await makeToken(page, { autoApprove: opts.autoApprove, rigId: rig.id });
  const agent = new McpAgent(url, token);
  await agent.initialize();
  return agent;
}

test("rejects a missing or wrong bearer token (401)", async ({ page, workspace }) => {
  const url = await serverUrl(page);
  expect(await new McpAgent(url, "").tryInitialize()).toBe(401);
  expect(await new McpAgent(url, "not-a-real-token").tryInitialize()).toBe(401);
  // A real token initializes.
  const token = await makeToken(page);
  expect(await new McpAgent(url, token).tryInitialize()).toBe(200);
  // keep workspace referenced for fixture lifetime
  expect(workspace.dir).toBeTruthy();
});

test("a user token sees the app-control surface but NOT run-only tools", async ({ page, workspace }) => {
  const url = await serverUrl(page);
  const agent = new McpAgent(url, await makeToken(page));
  await agent.initialize();
  const tools = await agent.listTools();
  expect(tools).toContain("list_tabs");
  expect(tools).toContain("focus_view");
  expect(tools).toContain("terminal_run");
  expect(tools).toContain("select_rig"); // unscoped → offered
  // Run-only + forbidden tools must never appear for a user token.
  expect(tools).not.toContain("ask_user");
  expect(tools).not.toContain("show_ui");
  expect(tools).not.toContain("bash_run");
  expect(tools).not.toContain("read_file");
  expect(workspace.dir).toBeTruthy();
});

test("select_rig resolves the launch rig; an unresolved call teaches", async ({ page, workspace }) => {
  const url = await serverUrl(page);
  const rig = await firstRig(page);
  const agent = new McpAgent(url, await makeToken(page)); // unscoped
  await agent.initialize();
  // Before selecting a rig, a tool call must return the teach-error.
  const unresolved = await agent.callTool("list_tabs");
  expect(unresolved.isError).toBe(true);
  expect(unresolved.text).toContain("rig-unresolved");
  // Selecting by the rig's real root resolves it.
  const sel = await agent.callTool("select_rig", { cwd: rig.root });
  expect(sel.status).toBe(200);
  const ok = await agent.callTool("list_tabs");
  expect(ok.isError, ok.text).toBe(false);
  expect(workspace.dir).toBeTruthy();
});

test("list_tabs returns the app's real tabs", async ({ page }) => {
  const url = await serverUrl(page);
  const agent = await pinnedAgent(page, url);
  const res = await agent.callTool("list_tabs");
  expect(res.isError).toBe(false);
  // The result serializes the live tab list — parseable JSON with a tabs array.
  const parsed = JSON.parse(res.text);
  expect(Array.isArray(parsed.tabs)).toBe(true);
});

test("focus_view brings a terminal forward (creates one if none)", async ({ page }) => {
  const url = await serverUrl(page);
  const agent = await pinnedAgent(page, url);
  const res = await agent.callTool("focus_view", { kind: "terminal" });
  expect(res.isError).toBe(false);
  // The app now has a terminal tab, and it is the active/foreground one —
  // observed through the SAME live tab state the app renders.
  const tabs = JSON.parse((await agent.callTool("list_tabs")).text).tabs as Array<{
    kind: string;
    active: boolean;
  }>;
  const activeTerminal = tabs.find((t) => t.kind === "terminal" && t.active);
  expect(activeTerminal).toBeTruthy();
});

test("terminal_run asks for approval; denying returns an error to the agent", async ({ page }) => {
  const url = await serverUrl(page);
  const agent = await pinnedAgent(page, url);
  await agent.callTool("focus_view", { kind: "terminal" });

  // Fire the call; it blocks on the approval card.
  const callPromise = agent.callTool("terminal_run", { command: "echo hello-mcp" });
  const denyBtn = page.getByRole("button", { name: "Deny" });
  await expect(denyBtn).toBeVisible({ timeout: 10_000 });
  await denyBtn.click();

  const res = await callPromise;
  expect(res.isError).toBe(true);
  expect(res.text.toLowerCase()).toContain("declined");
});

test("a catastrophic command is flagged even for an auto-approve token", async ({ page }) => {
  const url = await serverUrl(page);
  // Auto-approve would normally skip the card — but catastrophic always asks.
  const agent = await pinnedAgent(page, url, { autoApprove: true });
  await agent.callTool("focus_view", { kind: "terminal" });

  const callPromise = agent.callTool("terminal_run", { command: "rm -rf /" });
  await expect(page.getByText(/dangerous/i)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Deny" }).click();
  const res = await callPromise;
  expect(res.isError).toBe(true);
});

test("revoking the token blocks the next call (401)", async ({ page, workspace }) => {
  const url = await serverUrl(page);
  const token = await makeToken(page);
  const agent = new McpAgent(url, token);
  await agent.initialize();
  // Find the token id and revoke it.
  const tokens = await mcpInvoke<Array<{ id: string }>>(page, "mcp_token_list", {});
  expect(tokens.length).toBeGreaterThan(0);
  await mcpInvoke(page, "mcp_token_revoke", { id: tokens[tokens.length - 1].id });
  // The next authenticated request is rejected.
  expect(await agent.tryInitialize()).toBe(401);
  expect(workspace.dir).toBeTruthy();
});

test("an auto-approve token runs a safe terminal command without a card", async ({ page }) => {
  const url = await serverUrl(page);
  const agent = await pinnedAgent(page, url, { autoApprove: true });
  await agent.callTool("focus_view", { kind: "terminal" });
  // No approval card should appear; the call resolves with output.
  const res = await agent.callTool("terminal_run", { command: "echo mcp-ok" });
  expect(res.isError).toBe(false);
  expect(res.text).toContain("mcp-ok");
});

test("an existing MCP credential observes the global Auto run setting live", async ({ page }) => {
  const url = await serverUrl(page);
  const agent = await pinnedAgent(page, url, { autoApprove: false });
  await agent.callTool("focus_view", { kind: "terminal" });
  await openAiConversation(page);

  await page.getByRole("button", { name: /Auto-run is off/i }).click();
  await expect(page.getByRole("button", { name: /Auto-run is ON/i })).toBeVisible();
  const automatic = await agent.callTool("terminal_run", {
    command: "echo global-auto-run-ok",
  });
  expect(automatic.isError).toBe(false);
  expect(automatic.text).toContain("global-auto-run-ok");
  await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);

  await page.getByRole("button", { name: /Auto-run is ON/i }).click();
  const gated = agent.callTool("terminal_run", { command: "echo asks-again" });
  await expect(page.getByRole("button", { name: "Deny" })).toBeVisible();
  await page.getByRole("button", { name: "Deny" }).click();
  expect((await gated).isError).toBe(true);

  await page.getByRole("button", { name: /Auto-run is off/i }).click();
  const catastrophic = agent.callTool("terminal_run", { command: "sudo reboot" });
  await expect(page.getByText(/dangerous/i)).toBeVisible();
  await page.getByRole("button", { name: "Deny" }).click();
  expect((await catastrophic).isError).toBe(true);
});

test("browser control: navigate opens a tab, and screenshot is NOT vision-blocked", async ({
  page,
}) => {
  // A tiny local page so the test is offline + deterministic.
  const srv: Server = await new Promise((resolve) => {
    const s = createServer((_q, r) => {
      r.writeHead(200, { "Content-Type": "text/html" });
      r.end("<html><body><h1>MCP browser test page</h1></body></html>");
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const localUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
  try {
    const url = await serverUrl(page);
    const agent = await pinnedAgent(page, url, { autoApprove: true });

    // Navigate → a browser (preview) tab opens in the app.
    const nav = await agent.callTool("browser_navigate", { url: localUrl });
    expect(nav.isError).toBe(false);
    expect(JSON.parse(nav.text)).toMatchObject({ ok: true, url: localUrl });
    const tabs = JSON.parse((await agent.callTool("list_tabs")).text).tabs as Array<{
      kind: string;
    }>;
    expect(tabs.filter((t) => t.kind === "preview")).toHaveLength(1);

    // A successful first navigation must be usable immediately. Repeating the
    // same intent stays in that tab instead of compensating with a duplicate.
    const second = await agent.callTool("browser_navigate", { url: localUrl });
    expect(second.isError).toBe(false);
    expect(JSON.parse(second.text)).toMatchObject({ ok: true, url: localUrl });
    const afterSecond = JSON.parse((await agent.callTool("list_tabs")).text).tabs as Array<{
      kind: string;
    }>;
    expect(afterSecond.filter((t) => t.kind === "preview")).toHaveLength(1);

    // Screenshot must NOT fail with the "no vision support" error (the bug: the
    // MCP rig context wrongly reported the model as vision-less). It either
    // succeeds with image content or fails for an unrelated capture reason —
    // but never the vision block.
    const shot = await agent.callTool("browser_screenshot", {});
    expect(shot.text.toLowerCase()).not.toContain("no vision support");
  } finally {
    srv.close();
  }
});

test("negotiates the protocol version (echoes a supported request)", async ({ page, workspace }) => {
  const url = await serverUrl(page);
  const agent = new McpAgent(url, await makeToken(page));
  // Newest supported → echoed; an old-but-supported → echoed; unknown → latest.
  expect(await agent.initializeReturningVersion("2025-11-25")).toBe("2025-11-25");
  expect(await new McpAgent(url, await makeToken(page)).initializeReturningVersion("2025-06-18")).toBe(
    "2025-06-18",
  );
  expect(await new McpAgent(url, await makeToken(page)).initializeReturningVersion("1999-01-01")).toBe(
    "2025-11-25",
  );
  expect(workspace.dir).toBeTruthy();
});

test("a STATELESS client (no initialize, no session id) can drive the app", async ({ page }) => {
  // Models the 2026-07-28 stateless direction: a rig-pinned token, no handshake.
  const url = await serverUrl(page);
  const rig = await firstRig(page);
  const token = await makeToken(page, { autoApprove: true, rigId: rig.id });
  const agent = new McpAgent(url, token);
  agent.goStateless(); // never sends Mcp-Session-Id

  // tools/list with no session.
  const tools = await agent.listTools();
  expect(tools).toContain("focus_view");
  // tools/call with no session — the rig comes from the token, not a session.
  const focus = await agent.callTool("focus_view", { kind: "terminal" });
  expect(focus.isError).toBe(false);
  const run = await agent.callTool("terminal_run", { command: "echo stateless-ok" });
  expect(run.isError).toBe(false);
  expect(run.text).toContain("stateless-ok");
});

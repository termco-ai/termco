/**
 * LIVE end-to-end verification: a real external-agent CLI connects to the
 * REAL termco MCP server code (createMcpHttpServer + createProtocol) and
 * actually CALLS a termco tool. This closes the gap the raw-client E2E and the
 * stub-server checks leave open — real CLI ↔ our server, full tools/call.
 *
 * Skips unless TERMCO_LIVE_CLI=1 (needs the CLIs installed + logged in):
 *   TERMCO_LIVE_CLI=1 npx vitest run --config vitest.electron.config.ts \
 *     electron/main/coding-agent/../mcp-server/liveCli.test.ts
 *
 * The SSH variant additionally needs TERMCO_LIVE_SSH_HOST (e.g. opendoc-v2).
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mcpConfigJson, mcpSettings } from "../../../plugin-repository/plugins/coding-agent-native/src/claudeAdapter";
import { buildRemoteCommand, mcpReverseTunnelOpts } from "../../../plugin-repository/plugins/coding-agent-native/src/remote";
import { sshArgs } from "../../../plugin-repository/plugins/ssh-native/src/runner";
import { createMcpHttpServer } from "../../../plugin-repository/plugins/mcp-server-native/src/httpServer";
import { createProtocol, type ResolvedRig } from "../../../plugin-repository/plugins/mcp-server-native/src/protocol";
import { GET_CONTEXT_TOOL, SELECT_RIG_TOOL } from "../../../plugin-repository/plugins/mcp-server-native/src/toolProvider";
import { createTokenStore } from "../../../plugin-repository/plugins/mcp-server-native/src/tokens";

const LIVE = process.env.TERMCO_LIVE_CLI === "1";
const RIG: ResolvedRig = { rigId: "rig-live", rigName: "live" };

/** Stand up the real server with a recording stub tool provider. `list_tabs`
 * returns a fixed marker so we can prove the CLI both LISTED and CALLED it. */
function makeServer() {
  const calls: string[] = [];
  const tokens = createTokenStore({
    read: () => null,
    write: () => {},
    hash: (s) => createHash("sha256").update(s).digest("hex"),
    randomToken: () => randomBytes(24).toString("base64url"),
    now: () => Date.now(),
  });
  // A rig-pinned token → no select_rig needed; resolves with no session state.
  const token = tokens.createUserToken({ label: "live", rigId: RIG.rigId }).token;
  const protocol = createProtocol({
    serverVersion: "live",
    newSessionId: () => randomBytes(8).toString("hex"),
    builtinTools: { getContext: GET_CONTEXT_TOOL, selectRig: SELECT_RIG_TOOL },
    toolsFor: () => [
      {
        name: "list_tabs",
        description:
          "List the app's open tabs. Returns a JSON object with a `tabs` array.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    resolveRig: () => RIG,
    callTool: async ({ toolName }) => {
      calls.push(toolName);
      return {
        content: [
          { type: "text", text: JSON.stringify({ tabs: [{ title: "TERMCO_MARKER_TAB" }] }) },
        ],
      };
    },
  });
  const server = createMcpHttpServer({ tokens, protocol });
  return { server, token, calls };
}

/** Run a command, capture stdout, resolve on exit. */
function run(
  bin: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...opts.env },
      stdio: [opts.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => (stdout += String(c)));
    child.stderr?.on("data", (c) => (stderr += String(c)));
    if (opts.stdin != null) child.stdin?.end(opts.stdin);
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs ?? 45_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", () => resolve({ code: -1, stdout, stderr }));
  });
}

describe.skipIf(!LIVE)("live CLI ↔ real termco MCP server", () => {
  let ctx: ReturnType<typeof makeServer>;
  let port: number;

  beforeEach(async () => {
    ctx = makeServer();
    port = await ctx.server.listen(0);
  });
  afterEach(async () => {
    await ctx.server.close();
  });

  it("real claude discovers AND calls the termco list_tabs tool", { timeout: 90_000 }, async () => {
    const url = `http://127.0.0.1:${port}/mcp`;
    // Match the production adapter: --mcp-config with the
    // env-ref bearer + --settings allowing mcp__termco__* (NOT the dangerous
    // bypass flag, which the backend refuses as root anyway).
    const res = await run(
      "claude",
      [
        "-p",
        "Call the termco MCP tool `list_tabs` and tell me the title of the first tab, verbatim.",
        "--mcp-config",
        mcpConfigJson(url),
        "--settings",
        mcpSettings(),
      ],
      { env: { TERMCO_MCP_TOKEN: ctx.token }, timeoutMs: 80_000 },
    );
    // The server recorded a real tools/call, and the marker made it into the reply.
    expect(ctx.calls).toContain("list_tabs");
    expect(res.stdout).toContain("TERMCO_MARKER_TAB");
  });

  it("real codex discovers AND calls the termco list_tabs tool", { timeout: 90_000 }, async () => {
    const url = `http://127.0.0.1:${port}/mcp`;
    const res = await run(
      "codex",
      [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c",
        `mcp_servers.termco.url="${url}"`,
        "-c",
        `mcp_servers.termco.bearer_token_env_var="TERMCO_MCP_TOKEN"`,
        "Call the termco MCP tool list_tabs and print the first tab's title verbatim.",
      ],
      { env: { TERMCO_MCP_TOKEN: ctx.token }, timeoutMs: 80_000 },
    );
    expect(ctx.calls).toContain("list_tabs");
    expect(res.stdout).toContain("TERMCO_MARKER_TAB");
  });

  it.skipIf(!process.env.TERMCO_LIVE_SSH_HOST)(
    "a remote CLI reaches the server through the reverse tunnel with token-over-stdin",
    { timeout: 120_000 },
    async () => {
      const host = process.env.TERMCO_LIVE_SSH_HOST!;
      const [user, hostname] = host.includes("@")
        ? (host.split("@") as [string, string])
        : [undefined, host];
      const target = { connectionId: "live", host: hostname, user };
      const url = `http://127.0.0.1:${port}/mcp`;
      // Build the exact remote command the driver would: token-over-stdin
      // Wrapper + PATH prelude + the production invocation (MCP config and
      // settings-allow, no bypass flag).
      const remoteCmd = buildRemoteCommand(
        "claude",
        [
          "-p",
          "Call the termco MCP tool list_tabs and print the first tab title verbatim.",
          "--mcp-config",
          mcpConfigJson(url),
          "--settings",
          mcpSettings(),
        ],
        "",
        true, // stdin token prelude
      );
      const args = sshArgs(target, [remoteCmd], mcpReverseTunnelOpts(url));
      const res = await run("ssh", args, { stdin: `${ctx.token}\n`, timeoutMs: 110_000 });
      // The remote agent connected back through the tunnel and called our tool.
      expect(ctx.calls).toContain("list_tabs");
      expect(res.stdout + res.stderr).toContain("TERMCO_MARKER_TAB");
    },
  );
});
// Owned by the mcp-server-native provider plugin.
// Owned by the coding-agent-native provider plugin.

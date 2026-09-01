/**
 * A minimal streamable-HTTP MCP client — stands in for an EXTERNAL coding agent
 * (opencode, a custom agent) driving the app over the MCP control server. Used
 * by the E2E suite to prove that a real outside client can navigate/control the
 * app with a user token, and is correctly gated by auth/approval/revoke.
 */

export class McpAgent {
  private sessionId: string | null = null;
  private idSeq = 0;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    notification = false,
  ): Promise<{ status: number; body: unknown; sessionId: string | null }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const body = notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: ++this.idSeq, method, params };
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON (e.g. 202/empty) */
    }
    return { status: res.status, body: parsed, sessionId: this.sessionId };
  }

  /** Raw status of an initialize attempt (for auth tests). */
  async tryInitialize(): Promise<number> {
    const r = await this.rpc("initialize", { protocolVersion: "2025-06-18" });
    return r.status;
  }

  async initialize(): Promise<void> {
    const r = await this.rpc("initialize", { protocolVersion: "2025-06-18" });
    if (r.status !== 200) throw new Error(`initialize failed: ${r.status}`);
    await this.rpc("notifications/initialized", {}, true);
  }

  /** The negotiated protocol version from an initialize (for the version test). */
  async initializeReturningVersion(requested: string): Promise<string> {
    const r = await this.rpc("initialize", { protocolVersion: requested });
    return (r.body as { result?: { protocolVersion?: string } })?.result?.protocolVersion ?? "";
  }

  /** Drop any session id so subsequent calls go the STATELESS path (no
   * Mcp-Session-Id header) — models the 2026-07-28 stateless direction. */
  goStateless(): void {
    this.sessionId = null;
  }

  async listTools(): Promise<string[]> {
    const r = await this.rpc("tools/list");
    const tools = (r.body as { result?: { tools?: Array<{ name: string }> } })?.result?.tools ?? [];
    return tools.map((t) => t.name);
  }

  /** Call a tool; returns the JSON-RPC result (or throws on transport error). */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<{
    status: number;
    result: unknown;
    isError: boolean;
    text: string;
  }> {
    const r = await this.rpc("tools/call", { name, arguments: args });
    const result = (r.body as { result?: unknown })?.result ?? null;
    const content = (result as { content?: Array<{ text?: string }> })?.content ?? [];
    return {
      status: r.status,
      result,
      isError: Boolean((result as { isError?: boolean })?.isError),
      text: content.map((c) => c.text ?? "").join(""),
    };
  }
}

import { expect, it, vi } from "vitest";
import { SessionId, SessionRevision, type SessionHistoryCapability } from "@termco/session-base";
import type { WorkspaceFilesCapability } from "@termco/files-base";
import { DirectoryReadAccess } from "../../plugin-repository/plugins/ai-tools-files-native/src/directoryAccess";
import { createAiToolExecutor } from "../../plugin-repository/plugins/ai-registry-native/src/executor";

it("requires real user approval for directory access even in auto-run mode", async () => {
  const files = {
    canonicalize: vi.fn(async (path: string) => path),
    stat: vi.fn(async () => ({ kind: "dir" })),
  } as unknown as WorkspaceFilesCapability;
  const access = new DirectoryReadAccess(files);
  const runtime = { getSessionId: () => "chat", getWorkspaceEnv: () => ({ kind: "local" as const }) };
  const definition = access.tools(runtime).request_directory_access;
  const input = { path: "/etc/nginx", target: "Local computer", reason: "Inspect nginx configuration" };
  const history = {
    create: vi.fn(async () => undefined),
    append: vi.fn(async () => undefined),
    readWindow: vi.fn(async () => ({
      header: { formatVersion: 2, id: SessionId("chat"), createdAt: 1, authority: "v2", backend: "chat", fidelity: "full" },
      events: [], revision: SessionRevision(0), loadedRange: { start: 0, end: 0 },
      availability: { earlier: false, later: false }, fidelity: "full", repair: { state: "healthy" },
    })),
  } as unknown as SessionHistoryCapability;
  const executor = createAiToolExecutor({ history });
  expect(await executor.resolveApproval({ definition, input, mode: "allow-safe" }))
    .toMatchObject({ action: "ask", reason: { kind: "mandatory" } });
  const request = { backend: "mcp-tool" as const, externalRequestId: "directory-request", name: "request_directory_access", input, contributor: { pluginId: "ai-tools-files-native" }, definition };
  const denied = await executor.executeStandalone({ ...request, authorize: async () => ({ allow: false, outcome: "rejected", responder: "user" }) });
  expect(denied).toMatchObject({ ok: false, error: { code: "TOOL_DENIED" } });
  expect(files.stat).not.toHaveBeenCalled();
  expect(access.roots(runtime, { kind: "local" })).toEqual([]);
  const allowed = await executor.executeStandalone({ ...request, externalRequestId: "approved-directory-request", authorize: async () => ({ allow: true, outcome: "allowed-once", responder: "user" }) });
  expect(allowed).toMatchObject({ ok: true });
  expect(access.roots(runtime, { kind: "local" })).toEqual(["/etc/nginx"]);
});

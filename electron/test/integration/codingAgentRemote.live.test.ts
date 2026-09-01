/**
 * LIVE ssh verification of the remote PATH fix (plan: agent-app-control 02).
 * Runs the REAL probe/spawn command strings against a REAL host over ssh —
 * proving that a CLI installed in a user-local directory on
 * opendoc-v2) is found by BOTH the probe and the spawn path.
 *
 * Skips unless TERMCO_LIVE_SSH_HOST is set (same skip-not-red philosophy as
 * the liveTest fixtures):
 *
 *   TERMCO_LIVE_SSH_HOST=opendoc-v2 \
 *     npx vitest run --config vitest.electron.config.ts electron/main/coding-agent/remote.live.test.ts
 *
 * The host must be reachable via `ssh <host>` (ssh-config alias or user@host).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SshClientCapability, SshTarget } from "@termco/ssh-base";
import { destination, ok, runSsh, sshArgs } from "../../../plugin-repository/plugins/ssh-native/src/runner";
import {
  buildRemoteCommand,
  REMOTE_PROBE_MARKER,
  remoteProbeCommand,
} from "../../../plugin-repository/plugins/coding-agent-native/src/remote";
import {
  listRemoteSessions,
  readRemoteSessionEvents,
} from "../../../plugin-repository/plugins/coding-agent-native/src/remoteSessions";
import { configureCodingAgentRuntime } from "../../../plugin-repository/plugins/coding-agent-native/src/runtime";

beforeAll(() => {
  configureCodingAgentRuntime({
    ssh: { destination, ok, runSsh, sshArgs } as unknown as SshClientCapability,
  } as never);
});
afterAll(() => configureCodingAgentRuntime(null));

const HOST = process.env.TERMCO_LIVE_SSH_HOST ?? "";

function targetFromEnv(): SshTarget {
  const [user, host] = HOST.includes("@")
    ? (HOST.split("@") as [string, string])
    : [undefined, HOST];
  return { connectionId: "live-test", host, user };
}

describe.skipIf(!HOST)("remote PATH fix (live against $TERMCO_LIVE_SSH_HOST)", () => {
  it("probe finds claude even when it lives in ~/.local/bin", { timeout: 30_000 }, async () => {
    const out = await runSsh(targetFromEnv(), remoteProbeCommand("claude"), 20);
    expect(out.stdout).toContain(REMOTE_PROBE_MARKER);
  });

  it("probe finds codex", { timeout: 30_000 }, async () => {
    const out = await runSsh(targetFromEnv(), remoteProbeCommand("codex"), 20);
    expect(out.stdout).toContain(REMOTE_PROBE_MARKER);
  });

  it("the spawn command line resolves and runs a user-local claude", { timeout: 60_000 }, async () => {
    // Same construction as sshSpawnArgs uses — cd + exec through the prelude.
    const cmd = buildRemoteCommand("claude", ["--version"], "");
    const out = await runSsh(targetFromEnv(), cmd, 45);
    // Any version-shaped output proves the executable resolved through the
    // widened PATH.
    expect(out.stdout.trim()).toMatch(/\d+\.\d+/);
  });

  it("control: without the prelude the sshd PATH does NOT find claude (bug reproduced)", { timeout: 30_000 }, async () => {
    const naked = `command -v 'claude' >/dev/null 2>&1 && echo ${REMOTE_PROBE_MARKER}`;
    const out = await runSsh(targetFromEnv(), naked, 20);
    // If this starts finding the executable, the host moved it onto the default
    // PATH and this control stops being meaningful — not a product failure.
    expect(out.stdout).not.toContain(REMOTE_PROBE_MARKER);
  });
});

describe.skipIf(!HOST)("remote sessions (live against $TERMCO_LIVE_SSH_HOST)", () => {
  it("lists the host's sessions from the CLI index files and opens one transcript", { timeout: 60_000 }, async () => {
    const target = targetFromEnv();
    const sessions = await listRemoteSessions(target);
    // The test host has real coding-agent history.
    expect(sessions.length).toBeGreaterThan(0);
    const claude = sessions.filter((s) => s.backend === "claude");
    expect(claude.length).toBeGreaterThan(0);
    for (const s of claude.slice(0, 3)) {
      expect(s.sessionId).toBeTruthy();
      expect(s.cwd.startsWith("/")).toBe(true);
      expect(s.updatedAt).toBeGreaterThan(0);
    }
    // Open the newest transcript remotely; it must fold into events
    // (or, if the file was pruned on the host, into a clear "no longer exists"
    // error event — never a silent empty array for a bad reason).
    const newest = claude[0];
    const events = await readRemoteSessionEvents(target, {
      backend: "claude",
      projectSlug: newest.projectSlug,
      sessionId: newest.sessionId,
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it("a vanished session yields the honest error event", { timeout: 30_000 }, async () => {
    const events = await readRemoteSessionEvents(targetFromEnv(), {
      backend: "claude",
      projectSlug: "-nonexistent-project",
      sessionId: "00000000-0000-0000-0000-000000000000",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect((events[0] as { message: string }).message).toContain("no longer exists");
  });

  it("an unreachable host rejects the listing with a readable message", { timeout: 30_000 }, async () => {
    const bad: SshTarget = { connectionId: "dead", host: "127.0.0.1", port: 1, user: "nobody" };
    await expect(listRemoteSessions(bad)).rejects.toThrow(/unreachable/);
  });
});
// Owned by the coding-agent-native provider plugin.

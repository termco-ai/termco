// @vitest-environment jsdom

import type { WorkspaceEnv } from "@termco/workspace-base";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Tab } from "./useTabs";
import { useWorkspaceCwd } from "./useWorkspaceCwd";

afterEach(cleanup);

const LOCAL: NonNullable<WorkspaceEnv> = { kind: "local" };

function term(id: number, cwd?: string, rigId = "default"): Tab {
  return {
    id,
    kind: "terminal",
    rigId,
    title: "shell",
    cwd,
    paneTree: { kind: "leaf", id: id * 10, cwd },
    activeLeafId: id * 10,
  };
}

function editor(id: number, path = "/a/foo.ts", rigId = "default"): Tab {
  return {
    id,
    kind: "editor",
    rigId,
    title: "foo.ts",
    path,
    dirty: false,
    preview: false,
  };
}

type HookProps = {
  activeTab: Tab | undefined;
  tabs: Tab[];
  home: string | null;
  activeRigId?: string | null;
  env?: NonNullable<WorkspaceEnv>;
  rigRoot?: string | null;
  agentCwd?: string | null;
  rigsHydrated?: boolean;
};

function mount(props: HookProps) {
  return renderHook(
    ({
      activeTab,
      tabs,
      home,
      activeRigId,
      env,
      rigRoot,
      agentCwd,
      rigsHydrated,
    }: HookProps) =>
      useWorkspaceCwd({
        activeTab,
        tabs,
        home,
        activeRigId: activeRigId ?? "default",
        env: env ?? LOCAL,
        rigRoot: rigRoot ?? null,
        agentCwd: agentCwd ?? null,
        rigsHydrated: rigsHydrated ?? true,
      }),
    { initialProps: props },
  );
}

describe("explorerRoot", () => {
  it("uses the active terminal's cwd", () => {
    const t = term(1, "/w/proj");
    const { result } = mount({ activeTab: t, tabs: [t], home: "/home/u" });
    expect(result.current.explorerRoot).toBe("/w/proj");
  });

  it("remembers the last terminal cwd when an editor becomes active", () => {
    const t = term(1, "/w/proj");
    const e = editor(2);
    const { result, rerender } = mount({
      activeTab: t,
      tabs: [t, e],
      home: "/home/u",
    });
    rerender({ activeTab: e, tabs: [t, e], home: "/home/u" });
    expect(result.current.explorerRoot).toBe("/w/proj");
  });

  it("falls back to any terminal with a cwd when nothing was remembered", () => {
    const t = term(1, "/w/other");
    const e = editor(2);
    const { result } = mount({
      activeTab: e,
      tabs: [e, t],
      home: "/home/u",
    });
    expect(result.current.explorerRoot).toBe("/w/other");
  });

  it("falls back to home, then null", () => {
    const e = editor(2);
    const { result } = mount({ activeTab: e, tabs: [e], home: "/home/u" });
    expect(result.current.explorerRoot).toBe("/home/u");
    const { result: bare } = mount({ activeTab: e, tabs: [e], home: null });
    expect(bare.current.explorerRoot).toBeNull();
  });

  it("follows the agent's cwd when no terminal is the active surface", () => {
    const e = editor(2);
    const { result } = mount({
      activeTab: e,
      tabs: [e],
      home: "/home/u",
      agentCwd: "/w/Developer",
    });
    expect(result.current.explorerRoot).toBe("/w/Developer");
  });

  it("lets a focused terminal win over the agent's cwd", () => {
    const t = term(1, "/w/proj");
    const { result } = mount({
      activeTab: t,
      tabs: [t],
      home: "/home/u",
      agentCwd: "/w/Developer",
    });
    expect(result.current.explorerRoot).toBe("/w/proj");
  });

  it("ignores a terminal without a cwd", () => {
    const t = term(1, undefined);
    const { result } = mount({ activeTab: t, tabs: [t], home: "/home/u" });
    expect(result.current.explorerRoot).toBe("/home/u");
  });

  it("prefers the active rig's persisted root over home as a fallback", () => {
    const e = editor(2);
    const { result } = mount({
      activeTab: e,
      tabs: [e],
      home: "/home/u",
      rigRoot: "/w/rig-root",
    });
    expect(result.current.explorerRoot).toBe("/w/rig-root");
  });

  it("ignores the active tab's cwd when it belongs to another rig", () => {
    // Mid-switch: the active tab still points at the previous (local) rig
    // while activeRigId/env already moved to the new rig. Its cwd must NOT
    // become the root — that's how a local path leaked to the ssh backend.
    const stale = term(1, "/Users/x/local-proj", "local-rig");
    const { result } = mount({
      activeTab: stale,
      tabs: [stale],
      home: "/root",
      activeRigId: "ssh-rig",
      rigRoot: "/root",
    });
    expect(result.current.explorerRoot).toBe("/root");
  });

  it("stays null until rigs hydrate, whatever fallbacks exist", () => {
    // Mid-boot, adoptWorkspaceEnv has already pointed `home` at the restored
    // rig's remote home while the rigs store still reports no active
    // rig. Deriving a root here pairs it with the wrong env (local read of
    // /root, or ssh read of the launch cwd) — so there must be no root at all.
    const { result, rerender } = mount({
      activeTab: undefined,
      tabs: [],
      home: "/root",
      activeRigId: null,
      rigsHydrated: false,
    });
    expect(result.current.explorerRoot).toBeNull();

    rerender({
      activeTab: undefined,
      tabs: [],
      home: "/root",
      activeRigId: "ssh-rig",
      rigRoot: "/root",
      rigsHydrated: true,
    });
    expect(result.current.explorerRoot).toBe("/root");
  });

  it("does not leak the previous rig's cwd after a rig switch", () => {
    const localTerm = term(1, "/Users/x/local-proj", "local-rig");
    const { result, rerender } = mount({
      activeTab: localTerm,
      tabs: [localTerm],
      home: "/Users/x",
      activeRigId: "local-rig",
      rigRoot: "/Users/x/local-proj",
    });
    expect(result.current.explorerRoot).toBe("/Users/x/local-proj");

    // Switch to an ssh rig whose terminal has no cwd yet.
    const sshTerm = term(2, undefined, "ssh-rig");
    rerender({
      activeTab: sshTerm,
      tabs: [localTerm, sshTerm],
      home: "/root",
      activeRigId: "ssh-rig",
      rigRoot: "/root",
    });
    // Must be the ssh rig's root — never the leftover local project path.
    expect(result.current.explorerRoot).toBe("/root");
  });
});

describe("explorerEnv", () => {
  it("returns the active rig's env, paired with the root", () => {
    const ssh: WorkspaceEnv = {
      kind: "ssh",
      connectionId: "c1",
      host: "h",
    };
    const t = term(1, "/root", "ssh-rig");
    const { result } = mount({
      activeTab: t,
      tabs: [t],
      home: "/root",
      activeRigId: "ssh-rig",
      env: ssh,
    });
    expect(result.current.explorerEnv).toEqual(ssh);
  });
});

describe("inheritedCwdForNewTab", () => {
  it("inherits the active terminal's cwd", () => {
    const t = term(1, "/w/proj");
    const { result } = mount({ activeTab: t, tabs: [t], home: "/home/u" });
    expect(result.current.inheritedCwdForNewTab()).toBe("/w/proj");
  });

  it("inherits the last terminal cwd when an editor is active", () => {
    const t = term(1, "/w/proj");
    const e = editor(2);
    const { result, rerender } = mount({
      activeTab: t,
      tabs: [t, e],
      home: "/home/u",
    });
    rerender({ activeTab: e, tabs: [t, e], home: "/home/u" });
    expect(result.current.inheritedCwdForNewTab()).toBe("/w/proj");
  });

  it("falls back to home and finally undefined", () => {
    const e = editor(2);
    const { result } = mount({ activeTab: e, tabs: [e], home: "/home/u" });
    expect(result.current.inheritedCwdForNewTab()).toBe("/home/u");
    const { result: bare } = mount({ activeTab: e, tabs: [e], home: null });
    expect(bare.current.inheritedCwdForNewTab()).toBeUndefined();
  });
});

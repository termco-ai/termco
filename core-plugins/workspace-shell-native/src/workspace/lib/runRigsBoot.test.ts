import type { Tab } from "../tabs";
import type { PreferencesCapability } from "@termco/storage-base";
import type {
  WorkspaceCapability,
  WorkspaceRig,
  WorkspaceRigTabLayout,
  WorkspaceRigsCapability,
  WorkspaceRigsSnapshot,
  WorkspaceTabsCapability,
} from "@termco/workspace-base";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRigsBoot } from "./runRigsBoot";
import type { SerializedTab } from "./rigSerialization";

function meta(id: string, over: Partial<WorkspaceRig> = {}): WorkspaceRig {
  return {
    id,
    name: id,
    root: null,
    workspace: { kind: "local" },
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function rigProvider(initial: WorkspaceRig[], activeId: string | null) {
  let snapshot: WorkspaceRigsSnapshot = {
    hydrated: true,
    rigs: initial,
    activeId,
  };
  return {
    snapshot: () => snapshot,
    subscribe: vi.fn(() => () => {}),
    create: vi.fn((input = {}) => {
      const now = Date.now();
      const rig: WorkspaceRig = {
        id: input.id ?? `rig-${snapshot.rigs.length + 1}`,
        name: input.name ?? `Rig ${snapshot.rigs.length + 1}`,
        root: input.root ?? null,
        workspace: input.workspace ?? { kind: "local" },
        createdAt: now,
        updatedAt: now,
      };
      snapshot = { ...snapshot, rigs: [...snapshot.rigs, rig], activeId: rig.id };
      return rig;
    }),
    rename: vi.fn(),
    setWorkspace: vi.fn(),
    setColor: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
    activate: vi.fn(),
    cycle: vi.fn(),
  } satisfies WorkspaceRigsCapability;
}

function tabsProvider(layouts: readonly WorkspaceRigTabLayout[]) {
  return {
    savedLayouts: vi.fn(() => layouts),
  } as unknown as WorkspaceTabsCapability;
}

function terminalLayout(
  rigId: string,
  cwd: string,
  activeTabIndex = 0,
  splitTabIndex = -1,
): WorkspaceRigTabLayout {
  const tabs: SerializedTab[] = [
    { kind: "terminal", tree: { kind: "leaf", cwd, active: true } },
  ];
  return { rigId, tabs, activeTabIndex, splitTabIndex };
}

type BootOverrides = Partial<Parameters<typeof runRigsBoot>[0]>;

function makeParams(overrides: BootOverrides = {}) {
  let next = 100;
  const calls = {
    replaceTabs: vi.fn<(tabs: Tab[], activeId: number) => void>(),
    setSplit: vi.fn<(tabId: number) => void>(),
    markBooted: vi.fn(),
    setActiveRigForNewTabs: vi.fn(),
    adoptWorkspaceEnv: vi.fn(async () => null as string | null),
  };
  const workspaceRegistry = {
    authorize: vi.fn((path: string) => path),
  } as unknown as WorkspaceCapability;
  const preferences = {
    get: vi.fn(async () => "local"),
  } as unknown as PreferencesCapability;
  return {
    calls,
    workspaceRegistry,
    params: {
      ready: true,
      launchCwd: "/launch",
      home: "/home/u",
      allocId: () => next++,
      rigs: rigProvider([], null),
      workspaceTabs: tabsProvider([]),
      workspaceRegistry,
      preferences,
      ...calls,
      ...overrides,
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("first launch", () => {
  it("creates the provider-owned default rig without replacing the initial tab", async () => {
    const { calls, params } = makeParams();
    await runRigsBoot(params);
    expect(params.rigs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "default",
        name: "Default",
        root: "/launch",
        workspace: { kind: "local" },
      }),
    );
    expect(calls.setActiveRigForNewTabs).toHaveBeenCalledWith("default");
    expect(calls.replaceTabs).not.toHaveBeenCalled();
    expect(calls.markBooted).toHaveBeenCalledOnce();
  });

  it("falls back to home for the default rig root", async () => {
    const { params } = makeParams({ launchCwd: null });
    await runRigsBoot(params);
    expect(params.rigs.create).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/home/u" }),
    );
  });
});

describe("provider-owned restore", () => {
  it("ignores layouts for removed rigs and keeps the rig provider authoritative", async () => {
    const { calls, params } = makeParams({
      rigs: rigProvider([meta("local-new", { root: "/Users/test" })], "local-new"),
      workspaceTabs: tabsProvider([terminalLayout("old-remote", "/old")]),
    });
    await runRigsBoot(params);
    const [tabs] = calls.replaceTabs.mock.calls[0];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ rigId: "local-new", cwd: "/launch" });
  });

  it("rehydrates each rig, authorizes its cwd, and activates the saved tab", async () => {
    const { calls, params, workspaceRegistry } = makeParams({
      rigs: rigProvider([meta("a"), meta("b")], "b"),
      workspaceTabs: tabsProvider([
        terminalLayout("a", "/one"),
        terminalLayout("b", "/two"),
      ]),
    });
    await runRigsBoot(params);
    expect(workspaceRegistry.authorize).toHaveBeenCalledWith("/one", {
      kind: "local",
    });
    expect(workspaceRegistry.authorize).toHaveBeenCalledWith("/two", {
      kind: "local",
    });
    const [tabs, activeId] = calls.replaceTabs.mock.calls[0];
    expect(tabs.find((tab) => tab.id === activeId)?.rigId).toBe("b");
  });

  it("authorizes a remote cwd under the owning SSH rig, never local", async () => {
    const ssh = { kind: "ssh" as const, connectionId: "root@h", host: "h" };
    const { params, workspaceRegistry } = makeParams({
      rigs: rigProvider(
        [meta("local"), meta("remote", { workspace: ssh })],
        "local",
      ),
      workspaceTabs: tabsProvider([
        terminalLayout("local", "/Users/x/proj"),
        terminalLayout("remote", "/home/user"),
      ]),
    });
    await runRigsBoot(params);
    expect(workspaceRegistry.authorize).toHaveBeenCalledWith("/home/user", ssh);
    expect(workspaceRegistry.authorize).not.toHaveBeenCalledWith("/home/user", {
      kind: "local",
    });
  });

  it("spawns a fresh terminal when the active rig restored empty", async () => {
    const { calls, params } = makeParams({
      rigs: rigProvider([meta("a"), meta("b")], "b"),
      workspaceTabs: tabsProvider([terminalLayout("a", "/one")]),
    });
    await runRigsBoot(params);
    const [tabs, activeId] = calls.replaceTabs.mock.calls[0];
    const inB = tabs.filter((tab) => tab.rigId === "b");
    expect(inB).toHaveLength(1);
    expect(inB[0]).toMatchObject({ kind: "terminal", cwd: "/launch" });
    expect(activeId).toBe(inB[0].id);
  });

  it("prefers the adopted remote home for a fresh WSL tab", async () => {
    const { calls, params } = makeParams({
      rigs: rigProvider(
        [meta("w", { workspace: { kind: "wsl", distro: "Ubuntu" } })],
        "w",
      ),
      adoptWorkspaceEnv: vi.fn(async () => "/home/wsl"),
    });
    await runRigsBoot(params);
    expect(calls.replaceTabs.mock.calls[0][0][0]).toMatchObject({
      kind: "terminal",
      cwd: "/home/wsl",
    });
  });

  it("clamps an out-of-range active index and restores a valid split", async () => {
    const layout: WorkspaceRigTabLayout = {
      rigId: "a",
      tabs: [
        { kind: "editor", path: "/one.ts" },
        { kind: "editor", path: "/two.ts" },
      ],
      activeTabIndex: 9,
      splitTabIndex: 1,
    };
    const { calls, params } = makeParams({
      rigs: rigProvider([meta("a")], "a"),
      workspaceTabs: tabsProvider([layout]),
    });
    await runRigsBoot(params);
    const [tabs, activeId] = calls.replaceTabs.mock.calls[0];
    expect(activeId).toBe(tabs[0].id);
    expect(calls.setSplit).toHaveBeenCalledWith(tabs[1].id);
  });

  it("always marks booted and reports provider failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, params } = makeParams({
      workspaceTabs: {
        savedLayouts: () => {
          throw new Error("disk gone");
        },
      } as unknown as WorkspaceTabsCapability,
    });
    await runRigsBoot(params);
    expect(calls.markBooted).toHaveBeenCalledOnce();
    expect(calls.replaceTabs).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

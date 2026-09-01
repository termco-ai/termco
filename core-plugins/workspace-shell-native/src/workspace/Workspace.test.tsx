// @vitest-environment jsdom

import type { Tab } from "./tabs";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { UiHeaderFindTarget } from "@termco/ui-header-base";
import type { UiSurfaceSearchCapability } from "@termco/ui-tabs-base";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppShell } from "./components/AppShell";
import Workspace, { type WorkspaceShellRuntime } from "./Workspace";

type ShellProps = ComponentProps<typeof AppShell>;
const selectedTabKinds: WorkspaceShellRuntime["tabKinds"] = [];
const surfaceSearch = (() => {
  const entries = new Map<number, UiHeaderFindTarget>();
  const listeners = new Set<() => void>();
  const capability: UiSurfaceSearchCapability & { clear(): void } = {
    register(tabId, target) {
      entries.set(tabId, target);
      for (const listener of listeners) listener();
      return () => {
        if (entries.get(tabId) !== target) return;
        entries.delete(tabId);
        for (const listener of listeners) listener();
      };
    },
    target: (tabId) => entries.get(tabId) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      entries.clear();
      listeners.clear();
    },
  };
  return capability;
})();

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => {
  const tabsState = {
    tabs: [] as unknown[],
    activeId: 1,
    splitTabId: 0,
    focusedPane: "left" as "left" | "right",
  };
  const tabsApi = {
    setActiveId: vi.fn(),
    setSplit: vi.fn(),
    setFocusedPane: vi.fn((pane: "left" | "right") => {
      tabsState.focusedPane = pane;
    }),
    closeSplit: vi.fn(),
    allocId: vi.fn(() => 100),
    replaceTabs: vi.fn(),
    moveTabToRig: vi.fn(() => true),
    reorderTab: vi.fn(() => true),
    reorderTabByGap: vi.fn(),
    newTabInRig: vi.fn(() => 1),
    removeTabsForRig: vi.fn(),
    markBooted: vi.fn(),
    setActiveRigForNewTabs: vi.fn(),
    newTab: vi.fn(() => 1),
    newBlockTab: vi.fn(() => 1),
    newPrivateTab: vi.fn(() => 1),
    newPreviewTab: vi.fn(() => 1),
    openCommitHistoryTab: vi.fn(),
    openCommitFileDiffTab: vi.fn(),
    closeTab: vi.fn(),
    updateTab: vi.fn(),
    selectByIndex: vi.fn(),
    setLeafCwd: vi.fn(),
    focusPane: vi.fn(),
    focusNextPaneInTab: vi.fn(),
    splitActivePane: vi.fn(),
    closeActivePane: vi.fn(() => true),
    closePaneByLeaf: vi.fn(),
    resetWorkspace: vi.fn(),
  };
  const useTabsMock = vi.fn(() => ({
    ...tabsApi,
    tabs: tabsState.tabs,
    activeId: tabsState.activeId,
    splitTabId: tabsState.splitTabId,
    focusedPane: tabsState.focusedPane,
  }));

  const rigsState = {
    rigs: [{ id: "default" }, { id: "s2" }],
    activeId: "default" as string | null,
    hydrated: true,
    setActive: vi.fn(),
    reorder: vi.fn(),
  };

  const workspaceEnvironmentState = {
    workspace: { kind: "local" },
    home: "/home/u" as string | null,
    launchCwd: "/launch" as string | null,
    launchCwdResolved: true,
    wslDistros: [],
    wslLoading: false,
    wslError: null,
  };
  const workspaceEnvironment = {
    adopt: vi.fn(async () => "/home/u" as string | null),
    switch: vi.fn(async () => true),
    refreshWslDistros: vi.fn(async () => []),
  };
  const zoom = { zoomIn: vi.fn(), zoomOut: vi.fn(), zoomReset: vi.fn() };
  const aiSessions = {
    openPanel: vi.fn(),
    focusInput: vi.fn(),
    togglePanel: vi.fn(),
  };
  const workspaceCwd = {
    explorerRoot: "/root" as string | null,
    inheritedCwdForNewTab: vi.fn(() => "/inherited"),
  };
  const sidebar = {
    sidebarRef: { current: null },
    sidebarWidthRef: { current: 240 },
    sidebarView: "explorer",
    initialSidebarCollapsed: false,
    persistSidebarView: vi.fn(),
    persistSidebarCollapsed: vi.fn(),
    toggleSidebar: vi.fn(),
    cycleSidebarView: vi.fn(),
    persistSidebarWidth: vi.fn(),
    toggleExplorerFocus: vi.fn(),
  };
  const ret = {
    appCloseGuard: {
      pendingAppClose: false,
      confirmAppClose: vi.fn(),
      cancelAppClose: vi.fn(),
    },
    rigSync: undefined,
    tabCloseGuards: {
      pendingKindClose: null,
      pendingDeleteTabs: null,
      pendingBulkClose: null,
      handleClose: vi.fn(),
      handleCloseMany: vi.fn(),
      confirmKindClose: vi.fn(),
      cancelKindClose: vi.fn(),
      confirmDeleteClose: vi.fn(),
      cancelDeleteClose: vi.fn(),
      confirmBulkClose: vi.fn(),
      cancelBulkClose: vi.fn(),
      handlePathDeleted: vi.fn(),
    },
    tabFileActions: {
      openNewTab: vi.fn(),
      openNewPrivateTab: vi.fn(),
      openNewBlockTab: vi.fn(),
      cdInNewTab: vi.fn(),
      handlePathRenamed: vi.fn(),
    },
    workspaceControls: {
      openPreviewTab: vi.fn(() => 77),
      splitActivePaneInActiveTab: vi.fn(),
      handleCloseTabOrPane: vi.fn(),
      zenMode: false,
      setZenMode: vi.fn(),
      activateAgentTarget: vi.fn(),
    },
  };

  const captured = {
    shell: null as unknown,
    appShortcuts: null as unknown,
  };
  const editorSessions = {
    whenReady: vi.fn(async () => {}),
    gotoLine: vi.fn(() => true),
    selection: vi.fn(() => null),
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
  };
  const editorNavigation = {
    openFile: vi.fn(),
    openFileAt: vi.fn(() => 6),
    retargetPath: vi.fn(),
  };
  const terminalSessions = {
    open: vi.fn(() => ({ tabId: 5, leafId: 50 })),
    handle: vi.fn(() => null),
    focus: vi.fn(() => true),
    dispose: vi.fn(),
    selection: vi.fn(() => null),
  };
  const emptyPresentation = () => ({
    revision: 0,
    header: {
      tabs: [],
      allTabs: [],
      activeTabId: 0,
      agentsViewOpen: false,
      editorDirty: false,
      findTarget: null,
    },
    sidebar: {
      rootPath: null,
      workspace: { kind: "local" },
      activeFilePath: null,
    },
    context: {
      cwd: null,
      filePath: null,
      home: null,
      privateActive: false,
      zenMode: false,
    },
  });
  let presentationSnapshot: any = emptyPresentation();
  const presentation = {
    snapshot: () => presentationSnapshot,
    publish: vi.fn((state: any) => {
      presentationSnapshot = {
        revision: presentationSnapshot.revision + 1,
        ...state,
      };
    }),
    reset: () => {
      presentationSnapshot = emptyPresentation();
    },
  };
  let aiLiveContribution: Record<string, (...args: any[]) => any> = {};
  const aiLiveFallbacks: Record<string, (...args: any[]) => any> = {
    getCwd: () => null,
    getWorkspaceRoot: () => null,
    focusView: () => ({ ok: false }),
    setAgentCwd: () => {},
  };
  const aiLiveFacade = new Proxy(
    {},
    {
      get: (_target, key: string) =>
        (...args: any[]) =>
          (aiLiveContribution[key] ?? aiLiveFallbacks[key] ?? (() => null))(
            ...args,
          ),
    },
  ) as any;
  const aiLive = {
    contribute(partial: Record<string, (...args: any[]) => any>) {
      aiLiveContribution = partial;
      return () => {
        if (aiLiveContribution === partial) aiLiveContribution = {};
      };
    },
    resolve: () => aiLiveFacade,
    reset: () => {
      aiLiveContribution = {};
    },
  };

  return {
    tabsState,
    tabsApi,
    useTabsMock,
    rigsState,
    workspaceEnvironmentState,
    workspaceEnvironment,
    zoom,
    aiSessions,
    workspaceCwd,
    sidebar,
    ret,
    captured,
    editorNavigation,
    editorSessions,
    terminalSessions,
    presentation,
    aiLive,
  };
});

vi.mock("@/lib/usePresence", () => ({
  usePresence: (open: boolean) => ({
    mounted: open,
    state: open ? "open" : "closed",
  }),
}));

vi.mock("./hooks/useZoom", () => ({ useZoom: () => h.zoom }));

vi.mock("./hooks/useSidebarPanel", () => ({
  useSidebarPanel: () => h.sidebar,
}));

vi.mock("./tabs", () => ({
  DEFAULT_RIG_ID: "default",
  labelFor: (tab: Tab) => tab.title,
  useTabs: h.useTabsMock,
  useWindowTitle: vi.fn(),
  useWorkspaceCwd: vi.fn(() => h.workspaceCwd),
}));

vi.mock("./hooks/useAppCloseGuard", () => ({
  useAppCloseGuard: vi.fn(() => h.ret.appCloseGuard),
}));
vi.mock("./hooks/useAppShortcuts", () => ({
  useAppShortcuts: vi.fn((p: unknown) => {
    h.captured.appShortcuts = p;
  }),
}));
vi.mock("./hooks/useRigSync", () => ({
  useRigSync: vi.fn(() => h.ret.rigSync),
}));
vi.mock("./hooks/useTabFileActions", () => ({
  useTabFileActions: vi.fn(() => h.ret.tabFileActions),
}));
vi.mock("./hooks/useWorkspaceControls", () => ({
  useWorkspaceControls: vi.fn(() => h.ret.workspaceControls),
}));
vi.mock("./components/AppShell", () => ({
  AppShell: (p: unknown) => {
    h.captured.shell = p;
    return <div data-testid="app-shell" />;
  },
}));

function terminal(
  id: number,
  over?: {
    rigId?: string;
    leafId?: number;
    leafCwd?: string;
    cwd?: string;
    blocks?: boolean;
    priv?: boolean;
  },
): Tab {
  return {
    id,
    kind: "terminal",
    title: `t${id}`,
    rigId: over?.rigId ?? "default",
    cwd: over?.cwd,
    paneTree: { kind: "leaf", id: over?.leafId ?? 10, cwd: over?.leafCwd },
    activeLeafId: over?.leafId ?? 10,
    blocks: over?.blocks,
    private: over?.priv,
  };
}

function editor(id: number, path = "/src/a.ts"): Tab {
  return {
    id,
    kind: "editor",
    title: "a.ts",
    rigId: "default",
    path,
    dirty: false,
    preview: false,
  };
}

function renderApp(tabs?: Tab[], activeId = 1, splitTabId = 0) {
  h.tabsState.tabs = tabs ?? [terminal(1, { leafCwd: "/leaf-cwd" })];
  h.tabsState.activeId = activeId;
  h.tabsState.splitTabId = splitTabId;
  h.tabsState.focusedPane = "left";
  const tabActionsSnapshot = {
    revision: 0,
    pendingKindClose: h.ret.tabCloseGuards.pendingKindClose,
    pendingDeleteTabs: h.ret.tabCloseGuards.pendingDeleteTabs,
    pendingBulkClose: h.ret.tabCloseGuards.pendingBulkClose,
  };
  const agentsViewSnapshot = { revision: 0, open: false, openSequence: 0 };
  const settingsViewSnapshot = {
    revision: 0,
    open: false,
    requestedSection: null,
    openSequence: 0,
  };
  let overviewOpen = false;
  const rigsSnapshot = {
    hydrated: h.rigsState.hydrated,
    activeId: h.rigsState.activeId,
    rigs: h.rigsState.rigs.map((rig) => ({
      ...rig,
      name: rig.id,
      root: null,
      workspace: { kind: "local" as const },
      createdAt: 1,
      updatedAt: 1,
    })),
  };
  const runtime = {
    sidebarViews: [],
    tabKinds: selectedTabKinds,
    surfaceSearch,
    rigs: {
      snapshot: () => rigsSnapshot,
      subscribe: () => () => {},
      activate: h.rigsState.setActive,
      cycle: (delta: 1 | -1) => {
        const { rigs, activeId: rigId, setActive } = h.rigsState;
        if (rigs.length < 2) return;
        const index = rigs.findIndex((rig) => rig.id === rigId);
        setActive(rigs[(index + delta + rigs.length) % rigs.length].id);
      },
    },
    workspaceTabs: {
      snapshot: () => ({
        activeTabByRig: h.tabsState.tabs.reduce(
          (selected: Record<string, number>, tab: any) => {
            if (tab.id === h.tabsState.activeId) selected[tab.rigId] = tab.id;
            return selected;
          },
          {},
        ),
      }),
      savedLayouts: () => [],
      saveLayout: vi.fn(async () => undefined),
    },
    workspaceRegistry: {
      authorize: vi.fn((path: string) => path),
    },
    rigOverview: {
      snapshot: () => ({ revision: 0, open: overviewOpen }),
      subscribe: () => () => {},
      setOpen: (open: boolean) => {
        overviewOpen = open;
      },
    },
    editorNavigation: h.editorNavigation,
    editorSessions: h.editorSessions,
    markdownNavigation: { open: vi.fn() },
    terminalSessions: h.terminalSessions,
    aiSessions: h.aiSessions,
    aiLiveContributions: h.aiLive,
    tabActions: {
      snapshot: () => tabActionsSnapshot,
      subscribe: () => () => {},
      close: h.ret.tabCloseGuards.handleClose,
      closeMany: h.ret.tabCloseGuards.handleCloseMany,
      pathDeleted: h.ret.tabCloseGuards.handlePathDeleted,
      confirmKindClose: h.ret.tabCloseGuards.confirmKindClose,
      cancelKindClose: h.ret.tabCloseGuards.cancelKindClose,
      confirmDeleteClose: h.ret.tabCloseGuards.confirmDeleteClose,
      cancelDeleteClose: h.ret.tabCloseGuards.cancelDeleteClose,
      confirmBulkClose: h.ret.tabCloseGuards.confirmBulkClose,
      cancelBulkClose: h.ret.tabCloseGuards.cancelBulkClose,
    },
    agentsView: {
      snapshot: () => agentsViewSnapshot,
      subscribe: () => () => {},
      close: vi.fn(),
    },
    settingsView: {
      snapshot: () => settingsViewSnapshot,
      subscribe: () => () => {},
      close: vi.fn(),
    },
    preferences: {
      get: vi.fn(async () => undefined),
      getMany: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => false),
      subscribe: vi.fn(() => () => undefined),
    },
    workspaceEnvironment: {
      snapshot: () => h.workspaceEnvironmentState,
      subscribe: vi.fn(() => () => undefined),
      ...h.workspaceEnvironment,
    },
    tabPresentation: { Icon: () => null },
    shortcuts: {} as never,
    headerSearch: { focus: vi.fn(), register: vi.fn() },
    desktopWindow: {
      setTitle: vi.fn(async () => undefined),
      onCloseRequested: vi.fn(() => () => undefined),
      close: vi.fn(async () => undefined),
    },
    commands: {
      contribution: {} as never,
      install: vi.fn(() => () => undefined),
    },
    presentation: h.presentation,
  } as unknown as WorkspaceShellRuntime;
  const view = render(<Workspace runtime={runtime} />);
  return view;
}

function shell(): ShellProps {
  if (!h.captured.shell) throw new Error("AppShell not rendered");
  return h.captured.shell as ShellProps;
}

afterEach(() => {
  cleanup();
  surfaceSearch.clear();
});
beforeEach(() => {
  vi.clearAllMocks();
  h.captured.shell = null;
  h.tabsState.splitTabId = 0;
  h.rigsState.rigs = [{ id: "default" }, { id: "s2" }];
  h.rigsState.activeId = "default";
  h.presentation.reset();
  h.aiLive.reset();
});

describe("root composition", () => {
  // The AiComposerProvider wraps the whole shell via the ai plugin's
  // The provider contribution is registered directly by the source plugin.
  it("seeds useTabs with the capability-owned launch dir", () => {
    renderApp();
    expect(h.useTabsMock).toHaveBeenCalledWith(
      { cwd: "/launch" },
      expect.objectContaining({ snapshot: expect.any(Function) }),
      h.terminalSessions,
    );
  });

  it("boots without a launch dir and without an active rig", async () => {
    const { useWorkspaceCwd } = await import("./tabs");
    h.rigsState.activeId = null;
    h.workspaceEnvironmentState.launchCwd = null;
    renderApp();
    expect(h.useTabsMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ snapshot: expect.any(Function) }),
      h.terminalSessions,
    );
    // Falls back to the default rig for the strip filter (header mirror).
    expect(
      h.presentation
        .snapshot()
        .header.tabs.map((t: { id: number }) => t.id),
    ).toEqual([1]);
    // Falls back from the launch cwd to home for workspace cwd derivation.
    expect(vi.mocked(useWorkspaceCwd).mock.calls[0][0].home).toBe("/home/u");
    h.workspaceEnvironmentState.launchCwd = "/launch";
  });

  // useThemeFileEditing / useSshAutoConnect / useMcp* moved into the
  // legacy background plugin components;
  // useTerminalFileDrop and useEditorFileSync into the terminal-surface /
  // editor-surface plugins' Companions.
});

describe("header presentation read model", () => {
  it("mirrors only the active rig's tabs for the strip", () => {
    const tabs = [
      terminal(1, { leafId: 10 }),
      terminal(2, { rigId: "s2", leafId: 20 }),
    ];
    renderApp(tabs, 1);
    expect(
      h.presentation
        .snapshot()
        .header.tabs.map((t: { id: number }) => t.id),
    ).toEqual([1]);
    expect(h.presentation.snapshot().header.activeTabId).toBe(1);
    expect(shell().overlays.tabs.map((t) => t.id)).toEqual([1, 2]);
  });

  it("threads close confirmations to the selected workflow provider", () => {
    renderApp();
    shell().overlays.onConfirmKindClose();
    expect(h.ret.tabCloseGuards.confirmKindClose).toHaveBeenCalledOnce();
  });

  describe("split-view pane routing", () => {
    // Split: tab 1 in the left pane (activeId), tab 2 in the right pane.
    const splitTabs = () => [
      terminal(1, { leafId: 10 }),
      terminal(2, { leafId: 20 }),
    ];

    it("closing the left pane promotes the split tab to the sole active tab", () => {
      renderApp(splitTabs(), 1, 2);
      act(() => shell().workspace.onClosePane?.("left"));
      expect(h.tabsApi.setActiveId).toHaveBeenCalledWith(2);
      expect(h.tabsApi.closeSplit).toHaveBeenCalled();
    });

    it("closing the right pane just drops the split (left stays active)", () => {
      renderApp(splitTabs(), 1, 2);
      act(() => shell().workspace.onClosePane?.("right"));
      expect(h.tabsApi.closeSplit).toHaveBeenCalled();
      expect(h.tabsApi.setActiveId).not.toHaveBeenCalled();
    });
  });
});

describe("active tab derivations", () => {
  it("publishes the leaf cwd through workspace.presentation", () => {
    renderApp([terminal(1, { leafCwd: "/leaf-cwd", cwd: "/tab-cwd" })]);
    expect(h.presentation.snapshot().context.cwd).toBe("/leaf-cwd");
  });

  it("falls back to the tab cwd when the leaf has none", () => {
    renderApp([terminal(1, { cwd: "/tab-cwd" })]);
    expect(h.presentation.snapshot().context.cwd).toBe("/tab-cwd");
  });

  it("reports no terminal state for editor tabs", () => {
    renderApp([editor(1)], 1);
    expect(h.presentation.snapshot().context.cwd).toBeNull();
  });

  it("marks private terminals on the status bar", () => {
    renderApp([terminal(1, { priv: true })]);
    expect(h.presentation.snapshot().context.privateActive).toBe(true);
    cleanup();
    renderApp([terminal(1)]);
    expect(h.presentation.snapshot().context.privateActive).toBe(false);
  });
});

describe("active file path", () => {
  it("uses the editor path directly", () => {
    renderApp([editor(1, "/src/a.ts")]);
    expect(h.presentation.snapshot().context.filePath).toBe("/src/a.ts");
    expect(h.presentation.snapshot().sidebar.activeFilePath).toBe("/src/a.ts");
  });

  it("keeps absolute git-diff paths as-is", () => {
    const tab: Tab = {
      id: 1,
      kind: "git-diff",
      title: "d",
      rigId: "default",
      path: "/abs/file.ts",
      repoRoot: "/repo",
      mode: "-",
      originalPath: null,
    };
    renderApp([tab]);
    expect(h.presentation.snapshot().context.filePath).toBe("/abs/file.ts");
    expect(h.presentation.snapshot().sidebar.activeFilePath).toBeNull();
  });

  it("joins relative git-diff paths onto the repo root", () => {
    const tab: Tab = {
      id: 1,
      kind: "git-diff",
      title: "d",
      rigId: "default",
      path: "src/file.ts",
      repoRoot: "/repo//",
      mode: "-",
      originalPath: null,
    };
    renderApp([tab]);
    expect(h.presentation.snapshot().context.filePath).toBe(
      "/repo/src/file.ts",
    );
  });

  it("joins git-commit-file paths onto the repo root", () => {
    const tab: Tab = {
      id: 1,
      kind: "git-commit-file",
      title: "d",
      rigId: "default",
      repoRoot: "/repo",
      sha: "abc",
      shortSha: "abc",
      subject: "s",
      path: "/src/file.ts",
      originalPath: null,
    };
    renderApp([tab]);
    expect(h.presentation.snapshot().context.filePath).toBe(
      "/repo/src/file.ts",
    );
  });

  it("reports no file path for terminals", () => {
    renderApp();
    expect(h.presentation.snapshot().context.filePath).toBeNull();
  });

  it("exposes markdown paths to the explorer highlight", () => {
    renderApp([
      {
        id: 1,
        kind: "markdown",
        title: "m",
        rigId: "default",
        path: "/m.md",
      },
    ]);
    expect(h.presentation.snapshot().sidebar.activeFilePath).toBe("/m.md");
  });
});

describe("baseline parity: tab file actions", () => {
  it("opens a tab at the path, then cds and focuses its pane", () => {
    renderApp();

    shell().sidebar.viewProps.navigateToPath("/repo");

    expect(h.terminalSessions.open).toHaveBeenCalledExactlyOnceWith({
      cwd: "/repo",
    });
  });

  it("bails when the created tab is gone or not a terminal", () => {
    h.terminalSessions.open.mockReturnValueOnce({ tabId: 999, leafId: 998 });
    renderApp();

    expect(() =>
      shell().sidebar.viewProps.navigateToPath("/repo"),
    ).not.toThrow();
    expect(h.terminalSessions.open).toHaveBeenCalledExactlyOnceWith({
      cwd: "/repo",
    });
  });

  it("bails when the pane handle never registered", () => {
    renderApp();

    expect(() =>
      shell().sidebar.viewProps.navigateToPath("/repo"),
    ).not.toThrow();
    expect(h.terminalSessions.handle).not.toHaveBeenCalled();
  });
});

describe("search target (header mirror)", () => {
  it("is null without an addon or handle", () => {
    renderApp();
    expect(h.presentation.snapshot().header.findTarget).toBeNull();
  });

  it("targets the active terminal once its addon registers", async () => {
    renderApp();
    const focus = vi.fn();
    const handle = {
      kind: "terminal" as const,
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clear: vi.fn(),
      focus,
    };
    act(() => void surfaceSearch.register(1, handle));
    await waitFor(() =>
      expect(
        h.presentation.snapshot().header.findTarget,
      ).toMatchObject({
        kind: "terminal",
      }),
    );
    const target = h.presentation.snapshot().header.findTarget;
    if (target?.kind === "terminal") target.focus();
    expect(focus).toHaveBeenCalled();
  });

  it("targets the active editor once its handle registers", async () => {
    renderApp([editor(1)]);
    const focus = vi.fn();
    const handle = {
      kind: "editor" as const,
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clear: vi.fn(),
      focus,
    };
    act(() => void surfaceSearch.register(1, handle));
    await waitFor(() =>
      expect(
        h.presentation.snapshot().header.findTarget,
      ).toMatchObject({
        kind: "editor",
      }),
    );
    const target = h.presentation.snapshot().header.findTarget;
    if (target?.kind === "editor") target.focus();
    expect(focus).toHaveBeenCalled();
  });

  it("targets git history once its search handle registers", async () => {
    renderApp([
      {
        id: 1,
        kind: "git-history",
        title: "g",
        rigId: "default",
        repoRoot: "/repo",
      },
    ]);
    const handle = {
      kind: "git-history" as const,
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clear: vi.fn(),
      focus: vi.fn(),
    };
    act(() => void surfaceSearch.register(1, handle));
    await waitFor(() =>
      expect(
        h.presentation.snapshot().header.findTarget,
      ).toMatchObject({
        kind: "git-history",
      }),
    );
  });
});

describe("overlays group", () => {
  it("threads dialog state", () => {
    renderApp();
    const ov = shell().overlays;
    ov.onConfirmKindClose();
    expect(h.ret.tabCloseGuards.confirmKindClose).toHaveBeenCalledOnce();
    expect(ov.onCancelAppClose).toBe(h.ret.appCloseGuard.cancelAppClose);
    expect(ov.onConfirmAppClose).toBe(h.ret.appCloseGuard.confirmAppClose);
  });
});

describe("rig cycling", () => {
  it("cycles forward and backward with wrap-around", () => {
    renderApp();
    const shortcuts = h.captured.appShortcuts as {
      cycleRig: (d: 1 | -1) => void;
    };
    shortcuts.cycleRig(1);
    expect(h.rigsState.setActive).toHaveBeenCalledWith("s2");
    h.rigsState.setActive.mockClear();
    shortcuts.cycleRig(-1);
    expect(h.rigsState.setActive).toHaveBeenCalledWith("s2");
  });

  it("does nothing with a single space", () => {
    h.rigsState.rigs = [{ id: "default" }];
    renderApp();
    const shortcuts = h.captured.appShortcuts as {
      cycleRig: (d: 1 | -1) => void;
    };
    shortcuts.cycleRig(1);
    expect(h.rigsState.setActive).not.toHaveBeenCalled();
  });
});

describe("ai-live workspace contribution", () => {
  it("contributes the workspace queries to the ai-live registry", () => {
    renderApp([terminal(1, { leafCwd: "/leaf-cwd" }), editor(2)]);
    const live = h.aiLive.resolve();
    // Cwd resolution follows the active terminal's leaf.
    expect(live.getCwd()).toBe("/leaf-cwd");
    expect(live.getWorkspaceRoot()).toBe("/root");
    expect(live.getActiveKind()).toBe("terminal");
    expect(live.listTabs().map((t: { id: number }) => t.id)).toEqual([1, 2]);
    // focusView by id routes to setActiveId.
    expect(live.focusView({ id: 2 })).toEqual({ ok: true });
    expect(h.tabsApi.setActiveId).toHaveBeenCalledWith(2);
  });

  it("degrades to the fallbacks after unmount", () => {
    renderApp();
    cleanup();
    expect(h.aiLive.resolve().getCwd()).toBeNull();
    expect(h.aiLive.resolve().focusView({ id: 1 })).toEqual({ ok: false });
  });

  it("follows and releases the agent working directory", async () => {
    const { useWorkspaceCwd } = await import("./tabs");
    renderApp();

    act(() => h.aiLive.resolve().setAgentCwd("/work/agent"));
    await waitFor(() =>
      expect(vi.mocked(useWorkspaceCwd).mock.lastCall?.[0].agentCwd).toBe(
        "/work/agent",
      ),
    );

    act(() => h.aiLive.resolve().setAgentCwd(null));
    await waitFor(() =>
      expect(vi.mocked(useWorkspaceCwd).mock.lastCall?.[0].agentCwd).toBeNull(),
    );
  });
});

describe("zen mode plumbing", () => {
  it("publishes zen mode for the header/statusbar hosts", () => {
    renderApp();
    expect(h.presentation.snapshot().context.zenMode).toBe(false);
    h.ret.workspaceControls.zenMode = true;
    cleanup();
    renderApp();
    expect(h.presentation.snapshot().context.zenMode).toBe(true);
    h.ret.workspaceControls.zenMode = false;
  });
});

describe("current LegacyWorkspace parity", () => {
  it("seeds useTabs with the launch dir", () => {
    renderApp();

    expect(h.useTabsMock).toHaveBeenCalledWith(
      { cwd: "/launch" },
      expect.objectContaining({ snapshot: expect.any(Function) }),
      h.terminalSessions,
    );
  });

  it("derives the leaf cwd into the mirror", () => {
    renderApp([terminal(1, { leafCwd: "/leaf", cwd: "/tab" })]);

    expect(h.presentation.snapshot().context.cwd).toBe("/leaf");
  });

  it("delegates the surface-host callbacks to the pane handlers", () => {
    renderApp();
    const runtime = shell().workspace.createRuntime(1, () => {});

    runtime.openTab("terminal", { cwd: "/repo" });
    runtime.openTab("editor", { path: "/repo/app.ts", line: 12 });

    expect(h.terminalSessions.open).toHaveBeenCalledWith({
      cwd: "/repo",
      blocks: false,
      private: false,
    });
    expect(h.editorNavigation.openFileAt).toHaveBeenCalledWith(
      "/repo/app.ts",
      12,
    );
    expect(shell().workspace.contributions).toBe(selectedTabKinds);
  });

  it("registers NO legacy tab kinds itself", () => {
    renderApp();

    expect(shell().workspace.contributions).toBe(selectedTabKinds);
    expect(selectedTabKinds).toEqual([]);
  });

  it("removes the surface host when the App unmounts, leaving the registry alone", () => {
    const view = renderApp();
    const selectedRegistry = shell().workspace.contributions;

    view.unmount();

    expect(selectedRegistry).toBe(selectedTabKinds);
    expect(selectedTabKinds).toEqual([]);
  });

  it("mirrors zen mode for the header/statusbar hosts", () => {
    renderApp();
    expect(h.presentation.snapshot().context.zenMode).toBe(false);
    h.ret.workspaceControls.zenMode = true;
    cleanup();
    renderApp();

    expect(h.presentation.snapshot().context.zenMode).toBe(true);
    h.ret.workspaceControls.zenMode = false;
  });
});

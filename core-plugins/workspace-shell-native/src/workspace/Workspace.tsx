import {
  DEFAULT_RIG_ID,
  useTabs,
  useWorkspaceCwd,
} from "./tabs";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentActivityCapability } from "@termco/agents-base";
import type { AiLiveContributionCapability } from "@termco/ai-live-base";
import type { AiSessionsCapability } from "@termco/ai-sessions-base";
import type { BrowserTabsCapability } from "@termco/browser-base";
import type { DesktopWindowCapability } from "@termco/desktop-base";
import type {
  EditorNavigationCapability,
  EditorSessionsCapability,
  MarkdownNavigationCapability,
} from "@termco/editor-base";
import type { ContributionRecord } from "@termco/kernel";
import type { ShortcutRegistryCapability } from "@termco/shortcuts-base";
import type { PreferencesCapability } from "@termco/storage-base";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import type { UiAgentsViewCapability } from "@termco/ui-agents-base";
import type { UiHeaderSearchCapability } from "@termco/ui-header-base";
import type { UiSettingsViewCapability } from "@termco/ui-settings-base";
import type { UiSidebarViewContribution, UiSidebarNavigationCapability } from "@termco/ui-sidebar-base";
import type {
  UiSurfaceSearchCapability,
  UiTabKindContribution,
  UiTabPresentationCapability,
} from "@termco/ui-tabs-base";
import type {
  WorkspaceRigOverviewCapability,
  WorkspaceRigsCapability,
  WorkspaceTabActionsCapability,
  WorkspaceTabsCapability,
  WorkspaceEnvironmentCapability,
  WorkspacePresentationControlCapability,
  WorkspaceCapability,
  WorkspaceEnv,
} from "@termco/workspace-base";
import { AppShell } from "./components/AppShell";
import type { WorkspaceCommandCatalog } from "./commandCatalog";
import { useActiveTabDerived } from "./hooks/useActiveTabDerived";
import { useAiLiveWorkspace } from "./hooks/useAiLiveWorkspace";
import { useAppCloseGuard } from "./hooks/useAppCloseGuard";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useRigSync } from "./hooks/useRigSync";
import { useSidebarPanel } from "./hooks/useSidebarPanel";
import { useSplitPanes } from "./hooks/useSplitPanes";
import { useTabFileActions } from "./hooks/useTabFileActions";
import { useWorkspaceControls } from "./hooks/useWorkspaceControls";
import { useWorkspaceCoreCommands } from "./hooks/useWorkspaceCoreCommands";
import { useWorkspacePresentation } from "./hooks/useWorkspacePresentation";
import { useWindowTitle } from "./hooks/useWindowTitle";
import { useZoom } from "./hooks/useZoom";
import {
  createTabSurfaceRuntime,
  type ReplaceSearchRegistration,
} from "./tabSurfaceRuntime";

/**
 * Complete workspace application surface: tab/pane model, rig sync, close
 * guards, MRU, and shortcuts. AI wiring lives in AI/agent plugins; this
 * plugin publishes only public capabilities and consumes selected
 * application-wide providers.
 */
export type WorkspaceShellRuntime = {
  agentActivity: AgentActivityCapability;
  sidebarViews: ReadonlyArray<ContributionRecord<UiSidebarViewContribution>>;
  tabKinds: ReadonlyArray<ContributionRecord<UiTabKindContribution>>;
  sidebarNavigation: UiSidebarNavigationCapability;
  surfaceSearch: UiSurfaceSearchCapability;
  rigs: WorkspaceRigsCapability;
  workspaceTabs: WorkspaceTabsCapability;
  rigOverview: WorkspaceRigOverviewCapability;
  editorNavigation: EditorNavigationCapability;
  editorSessions: EditorSessionsCapability;
  markdownNavigation: MarkdownNavigationCapability;
  terminalSessions: TerminalSessionsCapability;
  browserTabs: BrowserTabsCapability;
  aiSessions: AiSessionsCapability;
  aiLiveContributions: AiLiveContributionCapability;
  tabActions: WorkspaceTabActionsCapability;
  agentsView: UiAgentsViewCapability;
  settingsView: UiSettingsViewCapability;
  preferences: PreferencesCapability;
  workspaceEnvironment: WorkspaceEnvironmentCapability;
  workspaceRegistry: WorkspaceCapability;
  tabPresentation: UiTabPresentationCapability;
  shortcuts: ShortcutRegistryCapability;
  headerSearch: UiHeaderSearchCapability;
  desktopWindow: DesktopWindowCapability;
  commands: WorkspaceCommandCatalog;
  presentation: WorkspacePresentationControlCapability;
};

const LOCAL_WORKSPACE: NonNullable<WorkspaceEnv> = { kind: "local" };

export default function Workspace({
  runtime,
}: {
  runtime: WorkspaceShellRuntime;
}) {
  const subscribeWorkspaceEnvironment = useCallback(
    (listener: () => void) => runtime.workspaceEnvironment.subscribe(listener),
    [runtime.workspaceEnvironment],
  );
  const snapshotWorkspaceEnvironment = useCallback(
    () => runtime.workspaceEnvironment.snapshot(),
    [runtime.workspaceEnvironment],
  );
  const workspaceEnvironment = useSyncExternalStore(
    subscribeWorkspaceEnvironment,
    snapshotWorkspaceEnvironment,
    snapshotWorkspaceEnvironment,
  );
  const { home, launchCwd, launchCwdResolved } = workspaceEnvironment;
  const {
    tabs,
    activeId,
    setActiveId,
    splitTabId,
    focusedPane,
    setFocusedPane,
    setSplit,
    closeSplit,
    allocId,
    replaceTabs,
    markBooted,
    setActiveRigForNewTabs,
    activateRigTab,
    newTab,
    newBlockTab,
    newPrivateTab,
    newPreviewTab,
    selectByIndex,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
  } = useTabs(
    launchCwd ? { cwd: launchCwd } : undefined,
    runtime.workspaceTabs,
    runtime.terminalSessions,
  );

  // Mirror `tabs` into a ref for boot, persistence, and close workflows that
  // must observe the latest provider-backed tab list.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const subscribeRigs = useCallback(
    (listener: () => void) => runtime.rigs.subscribe(listener),
    [runtime.rigs],
  );
  const snapshotRigs = useCallback(() => runtime.rigs.snapshot(), [runtime.rigs]);
  const rigsSnapshot = useSyncExternalStore(
    subscribeRigs,
    snapshotRigs,
    snapshotRigs,
  );
  const activeRigId = rigsSnapshot.activeId;
  const activeRig = rigsSnapshot.rigs.find((rig) => rig.id === activeRigId);
  const activeRigRoot = activeRig?.root ?? null;
  // The env that OWNS activeRigRoot — read from the same store snapshot so
  // the pair can never flip on different renders. The global env store is NOT
  // safe here: during boot, adoptWorkspaceEnv sets it to the restored rig's
  // env (e.g. ssh) long before workspace.rigs hydration publishes that rig's
  // root, and the interim renders would pair the launch cwd (local) with the
  // ssh env — shipping a local path to the remote backend (ENOENT).
  const activeRigEnv = activeRig?.workspace ?? LOCAL_WORKSPACE;
  const rigsHydrated = rigsSnapshot.hydrated;

  const {
    splitTab,
    leftTabs,
    leftActiveTab,
    focusActiveId,
    openInFocusedPane,
  } = useSplitPanes({
    tabs,
    activeId,
    splitTabId,
    focusedPane,
    setActiveId,
    setSplit,
    closeSplit,
    activeRigId,
    defaultRigId: DEFAULT_RIG_ID,
    tabsRef,
  });

  const { zoomIn, zoomOut, zoomReset } = useZoom(runtime.preferences);
  // The explorer contribution owns its imperative controller. The shell keeps
  // the stable focus proxy expected by the unchanged shortcut adapter.
  const explorerFocusRef = useRef({
    focus: () =>
      runtime.sidebarViews
        .find((entry) => entry.value.id === "explorer")
        ?.value.controller?.focus(),
    isFocused: () =>
      runtime.sidebarViews
        .find((entry) => entry.value.id === "explorer")
        ?.value.controller?.isFocused() ?? false,
  });

  const adoptWorkspaceEnv = useCallback(
    (env: WorkspaceEnv) => {
      if (!env) return Promise.resolve(null);
      return runtime.workspaceEnvironment.adopt(env);
    },
    [runtime.workspaceEnvironment],
  );

  useRigSync({
    tabs,
    activeId,
    splitTabId,
    setSplit,
    allocId,
    replaceTabs,
    markBooted,
    setActiveRigForNewTabs,
    activateRigTab,
    activeRigId,
    rigsHydrated,
    launchCwdResolved,
    launchCwd,
    home,
    tabsRef,
    adoptWorkspaceEnv,
    rigs: runtime.rigs,
    workspaceTabs: runtime.workspaceTabs,
    preferences: runtime.preferences,
    workspaceRegistry: runtime.workspaceRegistry,
  });

  const setSwitcherOpen = useCallback((value: SetStateAction<boolean>) => {
    const open = runtime.rigOverview.snapshot().open;
    runtime.rigOverview.setOpen(
      typeof value === "function" ? value(open) : value,
    );
  }, [runtime.rigOverview]);

  // The top tab strip shows the active rig's tabs.
  const rigTabs = useMemo(
    () => tabs.filter((t) => t.rigId === (activeRigId ?? DEFAULT_RIG_ID)),
    [tabs, activeRigId],
  );

  const {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    initialSidebarCollapsed,
    persistSidebarView,
    persistSidebarCollapsed,
    toggleSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  } = useSidebarPanel(runtime.sidebarNavigation, explorerFocusRef);

  const subscribeSettingsView = useCallback(
    (listener: () => void) => runtime.settingsView.subscribe(listener),
    [runtime.settingsView],
  );
  const snapshotSettingsView = useCallback(
    () => runtime.settingsView.snapshot(),
    [runtime.settingsView],
  );
  const settingsViewState = useSyncExternalStore(
    subscribeSettingsView,
    snapshotSettingsView,
    snapshotSettingsView,
  );
  const subscribeAgentsView = useCallback(
    (listener: () => void) => runtime.agentsView.subscribe(listener),
    [runtime.agentsView],
  );
  const snapshotAgentsView = useCallback(
    () => runtime.agentsView.snapshot(),
    [runtime.agentsView],
  );
  const agentsViewState = useSyncExternalStore(
    subscribeAgentsView,
    snapshotAgentsView,
    snapshotAgentsView,
  );
  const closeSettingsView = useCallback(
    () => runtime.settingsView.close(),
    [runtime.settingsView],
  );
  const agentsViewOpen = agentsViewState.open;
  const closeAgentsView = useCallback(
    () => runtime.agentsView.close(),
    [runtime.agentsView],
  );
  // Any rig switch (strip, popover, shortcut, palette) leaves the
  // full-window agents/settings views — clicking a workspace means "take me
  // there". (The per-rig CHAT binding moved to the ai plugin's Background.)
  const prevRigIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevRigIdRef.current;
    prevRigIdRef.current = activeRigId;
    // Only a REAL switch dismisses the full-window views — the async rig
    // hydration on boot (null → first id) also changes activeRigId and
    // must not close a view the user just opened.
    const realSwitch =
      prev != null && activeRigId != null && prev !== activeRigId;
    if (realSwitch) {
      closeAgentsView();
      closeSettingsView();
    }
  }, [activeRigId, closeAgentsView, closeSettingsView]);
  const {
    activeTab,
    privateActive,
    editorDirty,
    activeTerminalLeafCwd,
    activeFilePath,
    explorerActiveFilePath,
    searchTarget,
    captureActiveSelection,
  } = useActiveTabDerived({
    tabs,
    focusActiveId,
    activeId,
    terminalSessions: runtime.terminalSessions,
    editorSessions: runtime.editorSessions,
    surfaceSearch: runtime.surfaceSearch,
  });

  // The AI agent's temporary explorer root belongs to this workspace
  // instance. The public ai-live facade reaches the setter contributed below;
  // null releases the override when a terminal reclaims the view.
  const [agentCwd, setAgentCwd] = useState<string | null>(null);

  const { explorerRoot, explorerEnv, inheritedCwdForNewTab } = useWorkspaceCwd({
    activeTab,
    tabs,
    activeRigId,
    env: activeRigEnv,
    rigRoot: activeRigRoot,
    home: launchCwd ?? home,
    agentCwd,
    rigsHydrated,
  });

  const createSurfaceRuntime = useCallback(
    (surfaceActiveId: number, replaceSearch: ReplaceSearchRegistration) =>
      createTabSurfaceRuntime(
        {
          workspace: explorerEnv,
          rigs: rigsSnapshot.rigs,
          workspaceTabs: runtime.workspaceTabs,
          terminalSessions: runtime.terminalSessions,
          browserTabs: runtime.browserTabs,
          editorNavigation: runtime.editorNavigation,
          aiSessions: runtime.aiSessions,
          surfaceSearch: runtime.surfaceSearch,
        },
        surfaceActiveId,
        replaceSearch,
      ),
    [explorerEnv, rigsSnapshot.rigs, runtime],
  );

  useWindowTitle(activeTab, explorerRoot, runtime.desktopWindow);

  const subscribeTabActions = useCallback(
    (listener: () => void) => runtime.tabActions.subscribe(listener),
    [runtime.tabActions],
  );
  const snapshotTabActions = useCallback(
    () => runtime.tabActions.snapshot(),
    [runtime.tabActions],
  );
  const tabActionState = useSyncExternalStore(
    subscribeTabActions,
    snapshotTabActions,
    snapshotTabActions,
  );
  const { pendingKindClose, pendingDeleteTabs, pendingBulkClose } =
    tabActionState;
  const handleClose = useCallback(
    (id: number) => void runtime.tabActions.close(id),
    [runtime.tabActions],
  );
  const confirmKindClose = useCallback(
    () => runtime.tabActions.confirmKindClose(),
    [runtime.tabActions],
  );
  const cancelKindClose = useCallback(
    () => runtime.tabActions.cancelKindClose(),
    [runtime.tabActions],
  );
  const confirmDeleteClose = useCallback(
    () => runtime.tabActions.confirmDeleteClose(),
    [runtime.tabActions],
  );
  const cancelDeleteClose = useCallback(
    () => runtime.tabActions.cancelDeleteClose(),
    [runtime.tabActions],
  );
  const confirmBulkClose = useCallback(
    () => runtime.tabActions.confirmBulkClose(),
    [runtime.tabActions],
  );
  const cancelBulkClose = useCallback(
    () => runtime.tabActions.cancelBulkClose(),
    [runtime.tabActions],
  );

  const { pendingAppClose, confirmAppClose, cancelAppClose } =
    useAppCloseGuard(runtime.desktopWindow, runtime.terminalSessions);

  const cycleRig = useCallback(
    (delta: 1 | -1) => runtime.rigs.cycle(delta),
    [runtime.rigs],
  );

  const { openNewTab, openNewPrivateTab, openNewBlockTab } = useTabFileActions({
    newTab,
    newPrivateTab,
    newBlockTab,
    inheritedCwdForNewTab,
  });

  const toggleSourceControl = useCallback(
    () => cycleSidebarView("source-control"),
    [cycleSidebarView],
  );
  const {
    openPreviewTab,
    splitActivePaneInActiveTab,
    handleCloseTabOrPane,
    zenMode,
    setZenMode,
    activateAgentTarget,
  } = useWorkspaceControls({
    newPreviewTab,
    splitActivePane,
    closeActivePane,
    setActiveId,
    focusPane,
    activeId,
    tabsRef,
    handleClose,
    rigs: runtime.rigs,
  });

  // Pane-aware tab openers shared by the tab strip, command palette, and
  // keyboard shortcuts, so a new tab always lands in whichever split pane is
  // focused (not always the left one).
  const newTabInPane = useCallback(
    () => openInFocusedPane(openNewTab),
    [openInFocusedPane, openNewTab],
  );
  const newBlockTabInPane = useCallback(
    () => openInFocusedPane(openNewBlockTab),
    [openInFocusedPane, openNewBlockTab],
  );
  const newPrivateTabInPane = useCallback(
    () => openInFocusedPane(openNewPrivateTab),
    [openInFocusedPane, openNewPrivateTab],
  );
  const newPreviewTabInPane = useCallback(
    (url: string) => openInFocusedPane(() => openPreviewTab(url)),
    [openInFocusedPane, openPreviewTab],
  );

  useAppShortcuts({
    selectByIndex,
    focusNextPaneInTab,
    activeId,
    activeRigId,
    activeTab,
    openNewTab: newTabInPane,
    openNewBlockTab: newBlockTabInPane,
    openNewPrivateTab: newPrivateTabInPane,
    openPreviewTab: newPreviewTabInPane,
    handleCloseTabOrPane,
    cycleRig,
    setSwitcherOpen,
    splitActivePaneInActiveTab,
    toggleSourceControl,
    activateAgentTarget,
    toggleSidebar,
    toggleExplorerFocus,
    zoomIn,
    zoomOut,
    zoomReset,
    setZenMode,
    captureActiveSelection,
    openSettings: (sectionId) => runtime.settingsView.show(sectionId),
    aiSessions: runtime.aiSessions,
    agentActivity: runtime.agentActivity,
    shortcuts: runtime.shortcuts,
    editorNavigation: runtime.editorNavigation,
    editorSessions: runtime.editorSessions,
    terminalSessions: runtime.terminalSessions,
    focusSearch: () => runtime.headerSearch.focus(),
  });

  const activeCwd = activeTerminalLeafCwd;

  // Per-rig last-active selection is tab-domain state owned by the selected
  // workspace.tabs provider, shared by chat and tab-surface consumers.
  const activeTabByRig = runtime.workspaceTabs.snapshot().activeTabByRig;

  // Step 9a: the workspace core's ai-live capabilities (cwd/root/tab queries
  // + focus_view). Terminal/browser/explorer capabilities come from their
  // surface plugins.
  useAiLiveWorkspace({
    activeId,
    activeTabByRig,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    setActiveId,
    newTab,
    setAgentCwd,
  }, runtime.aiLiveContributions);

  // Header search is called through the selected header plugin's public
  // capability; no host-owned focus registry sits between the workspace and
  // the header input.
  // Publish workspace-owned palette items as one "workspace-core" source.
  // (Phase 3 step 4); every other group registers with its owner plugin.
  useWorkspaceCoreCommands(
    {
      tabs,
      activeId,
      searchTarget,
      openNewTab: newTabInPane,
      closeActiveTabOrPane: handleCloseTabOrPane,
      splitPaneRight: () => splitActivePaneInActiveTab("row"),
      splitPaneDown: () => splitActivePaneInActiveTab("col"),
      focusSearch: () => runtime.headerSearch.focus(),
      toggleSidebar,
      toggleAi: () => runtime.aiSessions.togglePanel(),
      askAiSelection: () => {
        const sessions = runtime.aiSessions;
        const selection = captureActiveSelection();
        sessions.openPanel();
        if (!selection?.trim()) {
          sessions.focusInput(null);
          return;
        }
        sessions.attachSelection(
          selection,
          activeTab?.kind === "editor" ? "editor" : "terminal",
        );
      },
      openSettings: (sectionId) => runtime.settingsView.show(sectionId),
      openAgents: () => runtime.agentsView.show(),
    },
    runtime.commands,
  );

  useWorkspacePresentation(
    {
      allTabs: tabs,
      rigTabs,
      activeTabId: focusActiveId,
      agentsViewOpen,
      editorDirty,
      findTarget: searchTarget,
      rootPath: explorerRoot,
      workspace: explorerEnv,
      activeFilePath: explorerActiveFilePath,
      cwd: activeCwd,
      filePath: activeFilePath,
      home,
      privateActive,
      zenMode,
    },
    runtime.presentation,
  );

  const sidebarViewProps = useMemo(
    () => ({
      rootPath: explorerRoot,
      workspace: explorerEnv,
      activeFilePath: explorerActiveFilePath,
      openFileAt: (path: string, line: number) => {
        runtime.editorNavigation.openFileAt(path, line);
      },
      openFile: (path: string, pin = false) => {
        if (/\.(md|markdown|mdx)$/i.test(path)) {
          runtime.markdownNavigation.open(path);
          return;
        }
        runtime.editorNavigation.openFile(path, pin);
      },
      navigateToPath: (path: string) => {
        runtime.terminalSessions.open({ cwd: path });
      },
      pathRenamed: (from: string, to: string) => {
        runtime.editorNavigation.retargetPath(from, to);
      },
      pathDeleted: (path: string) => runtime.tabActions.pathDeleted(path),
      attachFileToAgent: (path: string) => runtime.aiSessions.attachFile(path),
      runInNewTerminal: async (command: string, cwd?: string) => {
        const opened = runtime.terminalSessions.open({ cwd });
        await runtime.terminalSessions.whenReady(opened.leafId);
        runtime.terminalSessions.write(opened.leafId, `${command}\r`);
        runtime.terminalSessions.focus(opened.leafId);
      },
    }),
    [
      explorerActiveFilePath,
      explorerEnv,
      explorerRoot,
      runtime,
    ],
  );

  return (
    <AppShell
      settingsViewOpen={settingsViewState.open}
      agentsViewOpen={agentsViewOpen}
      sidebar={{
        sidebarRef,
        sidebarWidthRef,
        initialSidebarCollapsed,
        persistSidebarWidth,
        persistSidebarCollapsed,
        sidebarView,
        persistSidebarView,
        views: runtime.sidebarViews,
        viewProps: sidebarViewProps,
      }}
      workspace={{
        presentation: runtime.tabPresentation,
        contributions: runtime.tabKinds,
        createRuntime: createSurfaceRuntime,
        // Left/primary surface: all tabs except the split tab, active = activeId.
        tabs: leftTabs,
        activeId,
        activeTab: leftActiveTab,
        // Split (right) pane + focus wiring.
        splitTab,
        splitTabId,
        focusedPane,
        onFocusPane: setFocusedPane,
        // Closing a pane collapses the split and keeps the OTHER tab: closing
        // the left pane promotes the split (right) tab to the sole active tab;
        // closing the right pane just drops the split (left stays active).
        onClosePane: (pane: "left" | "right") => {
          if (pane === "left") setActiveId(splitTabId);
          closeSplit();
        },
      }}
      overlays={{
        tabs,
        pendingKindClose,
        onCancelKindClose: cancelKindClose,
        onConfirmKindClose: confirmKindClose,
        pendingDeleteTabs,
        onCancelDeleteClose: cancelDeleteClose,
        onConfirmDeleteClose: confirmDeleteClose,
        pendingBulkClose,
        onCancelBulkClose: cancelBulkClose,
        onConfirmBulkClose: confirmBulkClose,
        pendingAppClose,
        onCancelAppClose: cancelAppClose,
        onConfirmAppClose: confirmAppClose,
      }}
    />
  );
}

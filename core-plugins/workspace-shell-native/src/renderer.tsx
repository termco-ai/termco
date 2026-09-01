import { AGENTS_ACTIVITY_SERVICE, type AgentActivityCapability } from "@termco/agents-base";
import { AI_LIVE_CONTRIBUTIONS_SERVICE, type AiLiveContributionCapability } from "@termco/ai-live-base";
import { AI_SESSIONS_SERVICE, type AiSessionsCapability } from "@termco/ai-sessions-base";
import { BROWSER_TABS_SERVICE, type BrowserTabsCapability } from "@termco/browser-base";
import { DESKTOP_WINDOW_SERVICE, type DesktopWindowCapability } from "@termco/desktop-base";
import {
  EDITOR_NAVIGATION_SERVICE,
  EDITOR_SESSIONS_SERVICE,
  MARKDOWN_NAVIGATION_SERVICE,
  type EditorSessionsCapability,
  type EditorNavigationCapability,
  type MarkdownNavigationCapability,
} from "@termco/editor-base";
import {
  createLiveOptionalFacade,
  type Dispose,
  type PluginModule,
} from "@termco/kernel";
import { SHORTCUTS_REGISTRY_SERVICE, type ShortcutRegistryCapability } from "@termco/shortcuts-base";
import { SETTINGS_PREFERENCES_SERVICE } from "@termco/storage-base";
import { TERMINAL_SESSIONS_SERVICE, type TerminalSessionsCapability } from "@termco/terminal-base";
import {
  UI_COMMANDS_SERVICE,
  type UiCommandRegistry,
} from "@termco/ui-commands-base";
import {
  UI_CHANGE_REVEAL_ADAPTERS_SERVICE,
  type UiChangeRevealAdapter,
  type UiChangeRevealAdapterDirectory,
} from "@termco/ui-change-reveal-base";
import { UI_AGENTS_VIEW_SERVICE, type UiAgentsViewCapability } from "@termco/ui-agents-base";
import { UI_HEADER_SEARCH_SERVICE, type UiHeaderSearchCapability } from "@termco/ui-header-base";
import { UI_SETTINGS_VIEW_SERVICE, type UiSettingsViewCapability } from "@termco/ui-settings-base";
import {
  UI_SIDEBAR_NAVIGATION_SERVICE,
  UI_SIDEBAR_VIEWS_SERVICE,
  type UiSidebarNavigationCapability,
  type UiSidebarViewRegistry,
} from "@termco/ui-sidebar-base";
import {
  UI_SURFACE_SEARCH_SERVICE,
  UI_TABS_KINDS_SERVICE,
  UI_TABS_PRESENTATION_SERVICE,
  type UiSurfaceSearchCapability,
  type UiTabPresentationCapability,
  type UiTabKindRegistry,
} from "@termco/ui-tabs-base";
import {
  UI_WORKSPACE_VIEWS_SERVICE,
  type UiWorkspaceViewContribution,
  type UiWorkspaceViewRegistry,
} from "@termco/ui-workspace-base";
import {
  WORKSPACE_ENVIRONMENT_SERVICE,
  WORKSPACE_PRESENTATION_CONTROL_SERVICE,
  WORKSPACE_REGISTRY_SERVICE,
  WORKSPACE_RIGS_OVERVIEW_SERVICE,
  WORKSPACE_RIGS_SERVICE,
  WORKSPACE_TABS_SERVICE,
  WORKSPACE_TAB_ACTIONS_SERVICE,
  type WorkspaceTabActionsCapability,
  type WorkspacePresentationControlCapability,
  type WorkspaceCapability,
} from "@termco/workspace-base";
import Workspace, {
  type WorkspaceShellRuntime,
} from "./workspace/Workspace";
import { createWorkspaceCommandCatalog } from "./workspace/commandCatalog";
import ui from "@termco/ui";
import {
  createFallbackEnvironment,
  createFallbackPreferences,
  createFallbackRigOverview,
  createFallbackWorkspaceRigs,
  createFallbackWorkspaceTabs,
} from "./fallbacks";
import { createLiveSurfaceSearchFacade } from "./liveSurfaceSearch";

const { useSyncExternalStore } = ui.React;

const NO_SUBSCRIBE = () => () => {};
const EMPTY_SHORTCUTS_SNAPSHOT = {
  revision: 0,
  groups: [],
  shortcuts: [],
  overrides: {},
} as const;
const EMPTY_ACTIVITY = {
  subscribe: NO_SUBSCRIBE,
  snapshot: () => ({
    revision: 0,
    sessions: [],
    localAgent: null,
    notifications: [],
  }),
  nextAttentionTarget: () => null,
} as unknown as AgentActivityCapability;
const EMPTY_SIDEBAR_NAVIGATION = {
  subscribe: NO_SUBSCRIBE,
  snapshot: () => ({
    revision: 0,
    view: "explorer",
    initialCollapsed: false,
    width: 250,
  }),
  bindPanel: () => {},
  select: () => {},
  show: () => {},
  toggle: () => {},
  setCollapsed: () => {},
  setWidth: () => {},
  dispose: () => {},
} as UiSidebarNavigationCapability;
const EMPTY_SURFACE_SEARCH: UiSurfaceSearchCapability = {
  register: () => () => {},
  target: () => null,
  subscribe: NO_SUBSCRIBE,
};
const EMPTY_EDITOR_NAVIGATION = {
  openNewFile: () => {},
  openFile: () => 0,
  openFileAt: () => 0,
  retargetPath: () => 0,
} as unknown as EditorNavigationCapability;
const EMPTY_EDITOR_SESSIONS = {
  selection: () => null,
  undo: () => false,
  redo: () => false,
} as unknown as EditorSessionsCapability;
const EMPTY_MARKDOWN: MarkdownNavigationCapability = { open: () => 0 };
const EMPTY_TERMINALS = {
  open: () => ({ tabId: 0, leafId: 0 }),
  handle: () => null,
  focus: () => false,
  write: () => false,
  whenReady: async () => {},
  hasForegroundProcesses: async () => false,
  clearFocused: () => false,
  navigateFocusedBlocks: () => false,
  selection: () => null,
  dispose: () => {},
} as unknown as TerminalSessionsCapability;
const EMPTY_BROWSER_TABS = {
  open: () => 0,
} as unknown as BrowserTabsCapability;
const EMPTY_AI_SESSIONS = {
  subscribe: NO_SUBSCRIBE,
  snapshot: () => ({
    revision: 0,
    panelOpen: false,
    miniOpen: false,
    selectedModelId: "",
    activeSessionId: null,
    agent: { status: "idle", step: null, error: null },
  }),
  openPanel: () => {},
  togglePanel: () => {},
  attachFile: () => {},
  attachImage: () => {},
  attachSelection: () => {},
} as unknown as AiSessionsCapability;
const EMPTY_AI_LIVE: AiLiveContributionCapability = {
  contribute: () => () => {},
};
const EMPTY_TAB_ACTIONS = {
  subscribe: NO_SUBSCRIBE,
  snapshot: () => ({
    revision: 0,
    pendingKindClose: null,
    pendingDeleteTabs: null,
    pendingBulkClose: null,
  }),
  close: async () => {},
  pathDeleted: () => {},
  confirmKindClose: () => {},
  cancelKindClose: () => {},
  confirmDeleteClose: () => {},
  cancelDeleteClose: () => {},
  confirmBulkClose: () => {},
  cancelBulkClose: () => {},
} as unknown as WorkspaceTabActionsCapability;
const EMPTY_AGENTS_VIEW = {
  subscribe: NO_SUBSCRIBE,
  snapshot: () => ({ revision: 0, open: false, openSequence: 0 }),
  show: () => {},
  close: () => {},
} as unknown as UiAgentsViewCapability;
const EMPTY_SETTINGS_VIEW = {
  subscribe: NO_SUBSCRIBE,
  snapshot: () => ({
    revision: 0,
    open: false,
    requestedSection: null,
    openSequence: 0,
  }),
  show: () => {},
  close: () => {},
} as unknown as UiSettingsViewCapability;
const EMPTY_WORKSPACE_REGISTRY = {
  authorize: (path: string) => path,
  authorizeRoot: (path: string) => path,
  isAuthorized: () => false,
  canonicalize: (path: string) => path,
  currentDir: () => "",
  homeDir: () => "",
  resolvePath: (path: string) => path,
  normalize: (workspace: { kind?: string } | null | undefined) => ({
    kind:
      workspace?.kind === "wsl" || workspace?.kind === "ssh"
        ? workspace.kind
        : "local",
  }),
  toCanonicalDisplay: (path: string) => path,
  stripWindowsVerbatim: (path: string) => path,
  listWslDistros: () => [],
  defaultWslDistro: () => null,
  wslHome: () => "",
  wslPathToHost: (_distro: string, path: string) => path,
} as unknown as WorkspaceCapability;
const EMPTY_TAB_PRESENTATION: UiTabPresentationCapability = {
  Icon: () => null,
};
const EMPTY_SHORTCUTS = {
  subscribe: NO_SUBSCRIBE,
  snapshot: () => EMPTY_SHORTCUTS_SNAPSHOT,
  bindings: () => [],
  match: () => false,
  format: () => [],
  useHandlers(handlers, options) {
    const latest = ui.React.useRef({ handlers, options });
    latest.current = { handlers, options };
    ui.React.useLayoutEffect(() => {}, [null]);
  },
  setBindings: async () => {},
  reset: async () => {},
  resetAll: async () => {},
} as ShortcutRegistryCapability;
const EMPTY_HEADER_SEARCH: UiHeaderSearchCapability = {
  focus: () => {},
  register: () => () => {},
};
const EMPTY_DESKTOP_WINDOW = {
  close: async () => {},
  setTitle: async () => {},
  onCloseRequested: NO_SUBSCRIBE,
} as unknown as DesktopWindowCapability;
const EMPTY_PRESENTATION_CONTROL: WorkspacePresentationControlCapability = {
  publish: () => {},
};

export function createSidebarRevealAdapter(
  navigation: UiSidebarNavigationCapability,
): UiChangeRevealAdapter {
  return {
    id: "workspace-sidebar-reveal",
    services: ["ui.sidebar.views", "ui.tabs.kinds"],
    async reveal(request) {
      if (request.target.service === "ui.tabs.kinds") {
        const surface = [...document.querySelectorAll<HTMLElement>(
          '[data-contribution-service="ui.tabs.kinds"]',
        )].find((element) =>
          element.dataset.pluginOwner === request.target.pluginId &&
          element.dataset.pluginGeneration === request.target.generation &&
          element.dataset.contributionKey === request.target.key &&
          element.getAttribute("aria-hidden") !== "true"
        );
        return surface
          ? {
              status: "revealed" as const,
              target: request.target,
              message: "The already-open exact contributed tab surface was revealed.",
              element: surface,
            }
          : {
              status: "not-found" as const,
              target: request.target,
              message: "The tab kind is registered but no safe deterministic sample is open.",
            };
      }
      navigation.show(request.target.key);
      await Promise.resolve();
      const button = [...document.querySelectorAll<HTMLElement>(
        '[data-contribution-service="ui.sidebar.views"]',
      )].find((element) =>
        element.dataset.pluginOwner === request.target.pluginId &&
        element.dataset.pluginGeneration === request.target.generation &&
        element.dataset.contributionKey === request.target.key &&
        element.getAttribute("role") !== "heading"
      );
      if (!button) {
        return {
          status: "not-found" as const,
          target: request.target,
          message: "The exact sidebar rail target is no longer mounted.",
        };
      }
      return {
        status: "revealed" as const,
        target: request.target,
        message: "The sidebar selected and revealed the exact contribution.",
        element: button,
      };
    },
  };
}

const plugin: PluginModule = {
  inject: [
    UI_SIDEBAR_VIEWS_SERVICE,
    UI_TABS_KINDS_SERVICE,
    UI_WORKSPACE_VIEWS_SERVICE,
    UI_COMMANDS_SERVICE,
  ],
  optionalInject: [
    UI_CHANGE_REVEAL_ADAPTERS_SERVICE,
    AGENTS_ACTIVITY_SERVICE,
    UI_SIDEBAR_NAVIGATION_SERVICE,
    UI_SURFACE_SEARCH_SERVICE,
    WORKSPACE_RIGS_SERVICE,
    WORKSPACE_TABS_SERVICE,
    WORKSPACE_RIGS_OVERVIEW_SERVICE,
    EDITOR_NAVIGATION_SERVICE,
    EDITOR_SESSIONS_SERVICE,
    MARKDOWN_NAVIGATION_SERVICE,
    TERMINAL_SESSIONS_SERVICE,
    BROWSER_TABS_SERVICE,
    AI_SESSIONS_SERVICE,
    AI_LIVE_CONTRIBUTIONS_SERVICE,
    WORKSPACE_TAB_ACTIONS_SERVICE,
    UI_AGENTS_VIEW_SERVICE,
    UI_SETTINGS_VIEW_SERVICE,
    SETTINGS_PREFERENCES_SERVICE,
    WORKSPACE_ENVIRONMENT_SERVICE,
    WORKSPACE_REGISTRY_SERVICE,
    UI_TABS_PRESENTATION_SERVICE,
    SHORTCUTS_REGISTRY_SERVICE,
    UI_HEADER_SEARCH_SERVICE,
    DESKTOP_WINDOW_SERVICE,
    WORKSPACE_PRESENTATION_CONTROL_SERVICE,
  ],
  async activate(context) {
    const commands = createWorkspaceCommandCatalog();
    const facades: Array<{ dispose: Dispose }> = [];
    // Own the facade collection before any observer-backed facade is created.
    // This makes a partial activation transactional: if a later registration
    // fails, every subscription created below is already covered by a
    // lifecycle cleanup.
    await context.effect(() => async () => {
      for (const facade of facades.reverse()) await facade.dispose();
    });
    const live = <T extends object>(service: string, fallback: T): T => {
      const facade = createLiveOptionalFacade(
        context.observe<T>(service),
        fallback,
      );
      facades.push(facade);
      return facade.value;
    };
    const fallbackRigs = createFallbackWorkspaceRigs();
    const fallbackTabs = createFallbackWorkspaceTabs();
    const fallbackEnvironment = createFallbackEnvironment();
    const fallbackPreferences = createFallbackPreferences();
    const fallbackRigOverview = createFallbackRigOverview();
    const surfaceSearchFacade = createLiveSurfaceSearchFacade(
      context.observe<UiSurfaceSearchCapability>(UI_SURFACE_SEARCH_SERVICE),
      EMPTY_SURFACE_SEARCH,
    );
    facades.push(surfaceSearchFacade);
    const sidebarViewRegistry = context.get<UiSidebarViewRegistry>(
      UI_SIDEBAR_VIEWS_SERVICE,
    );
    const tabKindRegistry = context.get<UiTabKindRegistry>(
      UI_TABS_KINDS_SERVICE,
    );
    const runtime: WorkspaceShellRuntime = {
      agentActivity: live(AGENTS_ACTIVITY_SERVICE, EMPTY_ACTIVITY),
      sidebarViews: [],
      sidebarNavigation: live(
        UI_SIDEBAR_NAVIGATION_SERVICE,
        EMPTY_SIDEBAR_NAVIGATION,
      ),
      surfaceSearch: surfaceSearchFacade.value,
      tabKinds: [],
      rigs: live(WORKSPACE_RIGS_SERVICE, fallbackRigs),
      workspaceTabs: live(WORKSPACE_TABS_SERVICE, fallbackTabs),
      rigOverview: live(WORKSPACE_RIGS_OVERVIEW_SERVICE, fallbackRigOverview),
      editorNavigation: live(EDITOR_NAVIGATION_SERVICE, EMPTY_EDITOR_NAVIGATION),
      editorSessions: live(EDITOR_SESSIONS_SERVICE, EMPTY_EDITOR_SESSIONS),
      markdownNavigation: live(MARKDOWN_NAVIGATION_SERVICE, EMPTY_MARKDOWN),
      terminalSessions: live(TERMINAL_SESSIONS_SERVICE, EMPTY_TERMINALS),
      browserTabs: live(BROWSER_TABS_SERVICE, EMPTY_BROWSER_TABS),
      aiSessions: live(AI_SESSIONS_SERVICE, EMPTY_AI_SESSIONS),
      aiLiveContributions: live(AI_LIVE_CONTRIBUTIONS_SERVICE, EMPTY_AI_LIVE),
      tabActions: live(WORKSPACE_TAB_ACTIONS_SERVICE, EMPTY_TAB_ACTIONS),
      agentsView: live(UI_AGENTS_VIEW_SERVICE, EMPTY_AGENTS_VIEW),
      settingsView: live(UI_SETTINGS_VIEW_SERVICE, EMPTY_SETTINGS_VIEW),
      preferences: live(SETTINGS_PREFERENCES_SERVICE, fallbackPreferences),
      workspaceEnvironment: live(
        WORKSPACE_ENVIRONMENT_SERVICE,
        fallbackEnvironment,
      ),
      workspaceRegistry: live(WORKSPACE_REGISTRY_SERVICE, EMPTY_WORKSPACE_REGISTRY),
      tabPresentation: live(UI_TABS_PRESENTATION_SERVICE, EMPTY_TAB_PRESENTATION),
      shortcuts: live(SHORTCUTS_REGISTRY_SERVICE, EMPTY_SHORTCUTS),
      headerSearch: live(UI_HEADER_SEARCH_SERVICE, EMPTY_HEADER_SEARCH),
      desktopWindow: live(DESKTOP_WINDOW_SERVICE, EMPTY_DESKTOP_WINDOW),
      commands,
      presentation: live(
        WORKSPACE_PRESENTATION_CONTROL_SERVICE,
        EMPTY_PRESENTATION_CONTROL,
      ),
    };
    const sidebarReveal = createSidebarRevealAdapter(runtime.sidebarNavigation);
    await context.effect(() => {
      const observed = context.observe<UiChangeRevealAdapterDirectory>(
        UI_CHANGE_REVEAL_ADAPTERS_SERVICE,
      );
      let disposeRegistration: Dispose | undefined;
      const bind = () => {
        void disposeRegistration?.();
        disposeRegistration = observed.current()?.register(sidebarReveal, {
          pluginId: context.pluginId,
          generation: context.generation,
          key: sidebarReveal.id,
        });
      };
      const disposeObservation = observed.subscribe(bind);
      bind();
      return async () => {
        await disposeRegistration?.();
        await disposeObservation();
      };
    });
    const WorkspaceView = () => {
      const sidebarViews = useSyncExternalStore(
        sidebarViewRegistry.subscribe,
        sidebarViewRegistry.records,
        sidebarViewRegistry.records,
      );
      const tabKinds = useSyncExternalStore(
        tabKindRegistry.subscribe,
        tabKindRegistry.records,
        tabKindRegistry.records,
      );
      return (
        <Workspace
          runtime={{
            ...runtime,
            sidebarViews,
            tabKinds,
          }}
        />
      );
    };
    const workspace: UiWorkspaceViewContribution = {
      id: "workspace-shell",
      label: "Workspace",
      description:
        "Established resizable workspace, sidebar, retained panes, and close dialogs.",
      order: -100,
      Component: WorkspaceView,
    };
    await context.effect(() =>
      context.get<UiWorkspaceViewRegistry>(UI_WORKSPACE_VIEWS_SERVICE).register(
        workspace,
        { pluginId: "workspace-shell-native", generation: context.generation, key: workspace.id },
      ),
    );
    await context.effect(() =>
      context.get<UiCommandRegistry>(UI_COMMANDS_SERVICE).register(
        commands.contribution,
        {
          pluginId: "workspace-shell-native",
          generation: context.generation,
          key: commands.contribution.id,
        },
      ),
    );
  },
};

export default plugin;

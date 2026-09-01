import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import aboutNative from "../../plugin-repository/plugins/about-native/src/renderer";
import agentActivityNative from "../../plugin-repository/plugins/agent-activity-native/src/renderer";
import agentHooksMain from "../../plugin-repository/plugins/agent-hooks-native/src/main";
import agentHooksRenderer from "../../plugin-repository/plugins/agent-hooks-native/src/renderer";
import { MODELS as agentManagerModels } from "../../plugin-repository/plugins/agents-manager-native/src/models";
import agentsManagerNative from "../../plugin-repository/plugins/agents-manager-native/src/plugin";
import { libraryRuntimeActive as agentManagerRuntimeActive } from "../../plugin-repository/plugins/agents-manager-native/src/runtime";
import { aiNativeFilesActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/lib/native/native";
import { aiSpeechRuntimeActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/lib/stt";
import { aiAgentsViewActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/agentsView";
import { aiBrowserPolicyActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/browserPolicy";
import { aiCompactionRuntimeActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/compactionRuntime";
import { aiDockIntegrationsActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/dockIntegrations";
import { aiFileIconsActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/fileIcons";
import { aiLocalAgentNotificationsActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/localAgentNotifications";
import { aiEditorNavigationActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/navigation";
import { aiPlatformRuntimeActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/platform";
import { aiUiPreferencesActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/preferences";
import { aiSettingsNavigationActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/settings";
import { aiToolContributionCount } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/runtime/toolContributions";
import { aiAgentsStoreActive } from "../../plugin-repository/plugins/ai-chat-native/src/baseline/store/agentsStore";
import { chatRuntimeActive } from "../../plugin-repository/plugins/ai-chat-native/src/chatRuntime";
import aiChatNative from "../../plugin-repository/plugins/ai-chat-native/src/plugin";
import { sessionRuntimeActive } from "../../plugin-repository/plugins/ai-chat-native/src/runtime";
import {
  chats as aiChats,
  seedMessages as aiSeedMessages,
  toolContexts as aiToolContexts,
} from "../../plugin-repository/plugins/ai-chat-native/src/store/registry";
import aiContextArtifactsNative from "../../plugin-repository/plugins/ai-context-artifacts-native/src/main";
import aiDiffSurface from "../../plugin-repository/plugins/ai-diff-surface/src/renderer";
import { aiDiffRuntime } from "../../plugin-repository/plugins/ai-diff-surface/src/runtime";
import aiInferenceNative from "../../plugin-repository/plugins/ai-inference-native/src";
import aiLibraryNative from "../../plugin-repository/plugins/ai-library-native/src/main";
import aiLiveNative from "../../plugin-repository/plugins/ai-live-native/src/plugin";
import aiRegistryNative from "../../plugin-repository/plugins/ai-registry-native/src/plugin";
import aiSessionStateNative from "../../plugin-repository/plugins/ai-session-state-native/src/plugin";
import aiSpeechNative from "../../plugin-repository/plugins/ai-speech-native/src/plugin";
import aiToolsAskUserNative from "../../plugin-repository/plugins/ai-tools-ask-user-native/src/plugin";
import aiToolsBrowserNative from "../../plugin-repository/plugins/ai-tools-browser-native/src";
import aiToolsContainersNative from "../../plugin-repository/plugins/ai-tools-containers-native/src";
import aiToolsFilesNative from "../../plugin-repository/plugins/ai-tools-files-native/src";
import aiToolsGitNative from "../../plugin-repository/plugins/ai-tools-git-native/src/renderer";
import aiToolsLspNative from "../../plugin-repository/plugins/ai-tools-lsp-native/src/plugin";
import aiToolsManagedAgentsNative from "../../plugin-repository/plugins/ai-tools-managed-agents-native/src";
import aiToolsMcpNative from "../../plugin-repository/plugins/ai-tools-mcp-native/src/renderer";
import aiToolsPluginDevNative from "../../plugin-repository/plugins/ai-tools-plugin-dev-native/src";
import aiToolsSkillNative from "../../plugin-repository/plugins/ai-tools-skill-native/src/plugin";
import aiToolsSubagentsNative from "../../plugin-repository/plugins/ai-tools-subagents-native/src";
import aiToolsSystemNative from "../../plugin-repository/plugins/ai-tools-system-native/src/renderer";
import aiToolsTerminalNative from "../../plugin-repository/plugins/ai-tools-terminal-native/src";
import aiToolsTodoNative from "../../plugin-repository/plugins/ai-tools-todo-native/src/plugin";
import aiToolsTranscriptNative from "../../plugin-repository/plugins/ai-tools-transcript-native/src/plugin";
import aiToolsUiNative from "../../plugin-repository/plugins/ai-tools-ui-native/src";
import aiToolsWorkflowsNative from "../../plugin-repository/plugins/ai-tools-workflows-native/src";
import applicationIdentityMain from "../../plugin-repository/plugins/application-identity-native/src/main";
import applicationIdentityRenderer from "../../plugin-repository/plugins/application-identity-native/src/renderer";
import appearanceSettings from "../../plugin-repository/plugins/appearance-settings/src/renderer";
import bootDiagnosticsNative from "../../core-plugins/boot-diagnostics-native/src/main";
import { browserAiHandlerCount } from "../../plugin-repository/plugins/browser-native/src/aiControl";
import { browserEventsActive } from "../../plugin-repository/plugins/browser-native/src/events";
import browserNative, {
  browserCapabilityActive,
} from "../../plugin-repository/plugins/browser-native/src/main";
import { liveBrowserViews } from "../../plugin-repository/plugins/browser-native/src/registry";
import codingAgentMain, {
  codingAgentLifecycleResources,
} from "../../plugin-repository/plugins/coding-agent-native/src/main";
import { codingAgentRuntimeActive } from "../../plugin-repository/plugins/coding-agent-native/src/runtime";
import { codingAgentSessionJournalActive } from "../../plugin-repository/plugins/coding-agent-native/src/sessionJournal";
import codingAgentRenderer from "../../plugin-repository/plugins/coding-agent-native/ui/plugin";
import { codingAgentUiRuntimeActive } from "../../plugin-repository/plugins/coding-agent-native/ui/runtime";
import commandPaletteNative from "../../plugin-repository/plugins/command-palette-native/src/renderer";
import commandPaletteStateNative from "../../plugin-repository/plugins/command-palette-state-native/src/renderer";
import companyExampleCommand from "../../plugin-repository/plugins/company-example-command/src/renderer";
import companyExampleHttp from "../../plugin-repository/plugins/company-example-http/src/main";
import companyExampleStatusbar from "../../plugin-repository/plugins/company-example-statusbar/src/renderer";
import containersMain from "../../plugin-repository/plugins/containers-native/src/main";
import { containerIntegrationsActive } from "../../plugin-repository/plugins/containers-native/ui/lib/integrations";
import { containersNativeActive } from "../../plugin-repository/plugins/containers-native/ui/lib/native";
import containersRenderer from "../../plugin-repository/plugins/containers-native/ui/plugin";
import desktopNativeMain from "../../plugin-repository/plugins/desktop-native/src/main";
import desktopNativeRenderer from "../../plugin-repository/plugins/desktop-native/src/renderer";
import editorSettings from "../../plugin-repository/plugins/editor-settings/src/renderer";
import { editorNavigationRuntimeActive } from "../../plugin-repository/plugins/editor-surface-native/src/newFile";
import editorSurfaceNative from "../../plugin-repository/plugins/editor-surface-native/src/renderer";
import { editorRuntime } from "../../plugin-repository/plugins/editor-surface-native/src/runtime";
import eventsNative from "../../plugin-repository/plugins/events-native/src/renderer";
import explorerSidebar from "../../plugin-repository/plugins/explorer-sidebar/src/renderer";
import { explorerRuntime } from "../../plugin-repository/plugins/explorer-sidebar/src/runtime";
import fileIconsNative from "../../plugin-repository/plugins/file-icons-native/src/plugin";
import filesNative from "../../plugin-repository/plugins/files-native/src/main";
import { workspaceRuntimeActive as filesWorkspaceRuntimeActive } from "../../plugin-repository/plugins/files-native/src/runtime";
import generalSettings from "../../plugin-repository/plugins/general-settings/src/renderer";
import gitNative from "../../plugin-repository/plugins/git-native/src/main";
import { gitRuntimeActive } from "../../plugin-repository/plugins/git-native/src/runtime";
import gitSurface from "../../plugin-repository/plugins/git-surface/src/renderer";
import { gitSurfaceRuntime } from "../../plugin-repository/plugins/git-surface/src/runtime";
import { headerDependencies } from "../../plugin-repository/plugins/header-native/src/baseline/runtime";
import headerNative from "../../plugin-repository/plugins/header-native/src/renderer";
import historyNative from "../../plugin-repository/plugins/history-native/src/main";
import httpNative from "../../plugin-repository/plugins/http-native/src/main";
import languagesSettings from "../../plugin-repository/plugins/languages-settings/src/renderer";
import { lspManagerActive } from "../../plugin-repository/plugins/lsp-native/src";
import { lspConfigPathActive } from "../../plugin-repository/plugins/lsp-native/src/config";
import { lspInstallRootActive } from "../../plugin-repository/plugins/lsp-native/src/install";
import lspNative, {
  lspCapabilityActive,
} from "../../plugin-repository/plugins/lsp-native/src/main";
import { lspRuntime } from "../../plugin-repository/plugins/lsp-native/src/runtime";
import managedAgentRuntimeNative from "../../plugin-repository/plugins/managed-agent-runtime-native/src";
import markdownSurface from "../../plugin-repository/plugins/markdown-surface/src/renderer";
import { clients as mcpClients } from "../../plugin-repository/plugins/mcp-native/src";
import mcpNative from "../../plugin-repository/plugins/mcp-native/src/main";
import { mcpRuntimeActive } from "../../plugin-repository/plugins/mcp-native/src/runtime";
import mcpRigSync from "../../plugin-repository/plugins/mcp-rig-sync/src/renderer";
import mcpServerNative from "../../plugin-repository/plugins/mcp-server-native/src/main";
import mcpToolBridge from "../../plugin-repository/plugins/mcp-tool-bridge/src/renderer";
import modelsNative from "../../plugin-repository/plugins/models-native/src/renderer";
import modelsSettings from "../../plugin-repository/plugins/models-settings/src/renderer";
import onboardingContentNative from "../../plugin-repository/plugins/onboarding-content-native/src";
import onboardingNative from "../../plugin-repository/plugins/onboarding-native/src";
import onboardingUiNative from "../../plugin-repository/plugins/onboarding-ui-native/src";
import pluginManagerNative from "../../core-plugins/plugin-manager-native/src/renderer";
import portsSidebar from "../../plugin-repository/plugins/ports-sidebar/src/renderer";
import preferencesJson from "../../plugin-repository/plugins/preferences-json/src/main";
import previewSurfaceNative from "../../plugin-repository/plugins/preview-surface-native/src";
import ptyNative, {
  ptyCapabilityActive,
} from "../../plugin-repository/plugins/pty-native/src/main";
import {
  liveSessions as livePtySessions,
  ptySessionsConfigured,
} from "../../plugin-repository/plugins/pty-native/src/session";
import rigsCommands from "../../plugin-repository/plugins/rigs-commands/src/renderer";
import safeRecoveryNative from "../../core-plugins/safe-recovery-native/src/renderer";
import searchSidebar from "../../plugin-repository/plugins/search-sidebar/src/renderer";
import secretsNative from "../../plugin-repository/plugins/secrets-native/src/main";
import selectionAskAiNative from "../../plugin-repository/plugins/selection-ask-ai-native/src/renderer";
import settingsNative from "../../core-plugins/settings-native/src/renderer";
import shellNative from "../../plugin-repository/plugins/shell-native/src/main";
import { workspaceRuntimeActive as shellWorkspaceRuntimeActive } from "../../plugin-repository/plugins/shell-native/src/runtime";
import shortcutsNative from "../../plugin-repository/plugins/shortcuts-native/src/renderer";
import shortcutsSettings from "../../plugin-repository/plugins/shortcuts-settings/src/renderer";
import sidebarNavigationNative from "../../plugin-repository/plugins/sidebar-navigation-native/src/renderer";
import { detectorRuntimeActive as skillsDetectorRuntimeActive } from "../../plugin-repository/plugins/skills-panel-native/src/detector";
import { fileRuntimeActive as skillsFileRuntimeActive } from "../../plugin-repository/plugins/skills-panel-native/src/fileRuntime";
import { libraryRuntimeActive as skillsLibraryRuntimeActive } from "../../plugin-repository/plugins/skills-panel-native/src/libraryStore";
import skillsPanelNative from "../../plugin-repository/plugins/skills-panel-native/src/plugin";
import sourceControlSidebar from "../../plugin-repository/plugins/source-control-sidebar/src/renderer";
import { sourceControlRuntime } from "../../plugin-repository/plugins/source-control-sidebar/src/runtime";
import sshAutoConnect from "../../plugin-repository/plugins/ssh-auto-connect/src/renderer";
import {
  liveConnections,
  sshReadyObserverCount,
} from "../../plugin-repository/plugins/ssh-native/src/connection";
import { sshEventsActive } from "../../plugin-repository/plugins/ssh-native/src/events";
import sshNative, {
  sshCapabilityActive,
} from "../../plugin-repository/plugins/ssh-native/src/main";
import statusbarNative from "../../plugin-repository/plugins/statusbar-native/src/renderer";
import storageBridge from "../../plugin-repository/plugins/storage-bridge/src/renderer";
import storageJson from "../../plugin-repository/plugins/storage-json/src/main";
import sessionNativeMain from "../../plugin-repository/plugins/session-native/src/main";
import sessionNativeRenderer from "../../plugin-repository/plugins/session-native/src/renderer";
import sessionQueryNative from "../../plugin-repository/plugins/session-query-native/src/main";
import surfaceSearchNative from "../../plugin-repository/plugins/surface-search-native/src/renderer";
import terminalSettings from "../../plugin-repository/plugins/terminal-settings/src/renderer";
import terminalSurfaceNative from "../../plugin-repository/plugins/terminal-surface-native/src/renderer";
import {
  tabsRuntime,
  terminalRuntime,
} from "../../plugin-repository/plugins/terminal-surface-native/src/runtime";
import {
  terminalSessions,
  terminalSessionsConfigured,
} from "../../plugin-repository/plugins/terminal-surface-native/src/sessions";
import terminalWorkspaceFooterNative from "../../plugin-repository/plugins/terminal-workspace-footer-native/src/renderer";
import themeFileEditing from "../../plugin-repository/plugins/theme-file-editing/src/renderer";
import themeNative from "../../plugin-repository/plugins/theme-native/src/renderer";
import trajectoryNative from "../../plugin-repository/plugins/trajectory-native/src";
import { getTrajectoryRuntime } from "../../plugin-repository/plugins/trajectory-native/src/runtime";
import uiChangeRevealNative from "../../plugin-repository/plugins/ui-change-reveal-native/src";
import uiShellNative from "../../core-plugins/ui-shell-native/src/renderer";
import updaterMain from "../../core-plugins/updater-native/src/main";
import updaterRenderer from "../../core-plugins/updater-native/src/renderer";
import { updaterStateCount } from "../../core-plugins/updater-native/src/ui/useUpdater";
import workflowsNative from "../../plugin-repository/plugins/workflows-native/src";
import workspaceEnvironmentNative from "../../plugin-repository/plugins/workspace-environment-native/src/renderer";
import workspaceNative from "../../plugin-repository/plugins/workspace-native/src/main";
import workspacePresentationNative from "../../plugin-repository/plugins/workspace-presentation-native/src/plugin";
import workspaceRigWorkflowsNative from "../../plugin-repository/plugins/workspace-rig-workflows-native/src/renderer";
import workspaceRigsNative from "../../plugin-repository/plugins/workspace-rigs-native/src/plugin";
import workspaceShellNative from "../../core-plugins/workspace-shell-native/src/renderer";
import workspaceTabActionsNative from "../../plugin-repository/plugins/workspace-tab-actions-native/src/renderer";
import workspaceTabsNative, {
  workspaceTabsRuntimeActive,
} from "../../plugin-repository/plugins/workspace-tabs-native/src/plugin";
import type { ResolvedPluginTree, TermcoPluginManifestV3 } from "./contracts";
import { certifyPluginLifecycle } from "./lifecycleCertification";
import { essentialPluginReasons } from "./pluginDeactivationPolicy";
import type { RuntimeProcess } from "./processGraph";
import {
  CapabilityRuntime,
  kernelEventsService,
  type PluginActivationContext,
  type PluginModule,
} from "./runtime";

const privilegedResources = vi.hoisted(() => ({
  powerResumeListeners: 0,
  updateDownloadListeners: 0,
  updateFinishedListeners: 0,
  watchers: 0,
  ptys: 0,
}));

vi.mock("chokidar", () => ({
  watch: () => {
    privilegedResources.watchers += 1;
    let closed = false;
    const watcher = {
      on: () => watcher,
      close: async () => {
        if (closed) return;
        closed = true;
        privilegedResources.watchers -= 1;
      },
    };
    return watcher;
  },
}));

vi.mock("node-pty", () => ({
  spawn: () => {
    privilegedResources.ptys += 1;
    let killed = false;
    return {
      pid: 1,
      onData: () => {},
      onExit: () => {},
      write: () => {},
      resize: () => {},
      kill: () => {
        if (killed) return;
        killed = true;
        privilegedResources.ptys -= 1;
      },
    };
  },
}));

vi.mock("electron-updater", () => {
  const autoUpdater = {
    autoDownload: true,
    on(event: string) {
      if (event === "download-progress")
        privilegedResources.updateDownloadListeners += 1;
      if (event === "update-downloaded")
        privilegedResources.updateFinishedListeners += 1;
      return autoUpdater;
    },
    off(event: string) {
      if (event === "download-progress")
        privilegedResources.updateDownloadListeners -= 1;
      if (event === "update-downloaded")
        privilegedResources.updateFinishedListeners -= 1;
      return autoUpdater;
    },
    checkForUpdates: async () => null,
    downloadUpdate: async () => {},
    quitAndInstall: () => {},
  };
  return { default: { autoUpdater } };
});

vi.mock("electron", () => ({
  app: {
    getPath: () => join(process.cwd(), ".termco-cache", "lifecycle-test-data"),
    getName: () => "Termco",
    getVersion: () => "1.0.0",
    whenReady: async () => {},
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) =>
      value.toString("utf8").replace(/^encrypted:/, ""),
  },
  BrowserWindow: {
    fromId: () => null,
    fromWebContents: () => null,
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  clipboard: { readText: () => "", writeText: () => {} },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
  webContents: { fromId: () => null },
  powerMonitor: {
    on(event: string) {
      if (event === "resume") privilegedResources.powerResumeListeners += 1;
    },
    removeListener(event: string) {
      if (event === "resume") privilegedResources.powerResumeListeners -= 1;
    },
  },
  WebContentsView: class {},
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  session: { fromPartition: () => ({}) },
  shell: {
    openExternal: async () => {},
    openPath: async () => "",
    showItemInFolder: () => {},
  },
}));

interface Subject {
  pluginId: string;
  process: RuntimeProcess;
  module: PluginModule;
  fixtureCapabilities?: Record<
    string,
    (resources: FixtureResources) => unknown
  >;
  snapshotResources?(): Record<string, string | number | boolean | null>;
}

// Each subject uses the real source module and validates lifecycle cleanup.
const subjects: Subject[] = [
  {
    pluginId: "application-identity-native",
    process: "main",
    module: applicationIdentityMain,
  },
  {
    pluginId: "application-identity-native",
    process: "renderer",
    module: applicationIdentityRenderer,
  },
  {
    pluginId: "file-icons-native",
    process: "renderer",
    module: fileIconsNative,
  },
  {
    pluginId: "ai-registry-native",
    process: "renderer",
    module: aiRegistryNative,
  },
  {
    pluginId: "ai-session-state-native",
    process: "renderer",
    module: aiSessionStateNative,
  },
  { pluginId: "workspace-native", process: "main", module: workspaceNative },
  { pluginId: "mcp-server-native", process: "main", module: mcpServerNative },
  { pluginId: "events-native", process: "renderer", module: eventsNative },
  {
    pluginId: "surface-search-native",
    process: "renderer",
    module: surfaceSearchNative,
  },
  {
    pluginId: "ai-tools-ui-native",
    process: "renderer",
    module: aiToolsUiNative,
  },
  {
    pluginId: "command-palette-state-native",
    process: "renderer",
    module: commandPaletteStateNative,
  },
  {
    pluginId: "ai-tools-managed-agents-native",
    process: "renderer",
    module: aiToolsManagedAgentsNative,
  },
  {
    pluginId: "workspace-presentation-native",
    process: "renderer",
    module: workspacePresentationNative,
  },
  {
    pluginId: "ai-tools-todo-native",
    process: "renderer",
    module: aiToolsTodoNative,
  },
  {
    pluginId: "company-example-statusbar",
    process: "renderer",
    module: companyExampleStatusbar,
  },
  {
    pluginId: "ai-tools-ask-user-native",
    process: "renderer",
    module: aiToolsAskUserNative,
  },
  { pluginId: "models-native", process: "renderer", module: modelsNative },
  {
    pluginId: "ai-tools-plugin-dev-native",
    process: "renderer",
    module: aiToolsPluginDevNative,
  },
  { pluginId: "ai-live-native", process: "renderer", module: aiLiveNative },
  { pluginId: "http-native", process: "main", module: httpNative },
  {
    pluginId: "company-example-command",
    process: "renderer",
    module: companyExampleCommand,
  },
  {
    pluginId: "company-example-http",
    process: "main",
    module: companyExampleHttp,
  },
  { pluginId: "secrets-native", process: "main", module: secretsNative },
  {
    pluginId: "sidebar-navigation-native",
    process: "renderer",
    module: sidebarNavigationNative,
  },
  { pluginId: "storage-bridge", process: "renderer", module: storageBridge },
  { pluginId: "storage-json", process: "main", module: storageJson },
  {
    pluginId: "ai-tools-skill-native",
    process: "renderer",
    module: aiToolsSkillNative,
  },
  {
    pluginId: "ai-tools-lsp-native",
    process: "renderer",
    module: aiToolsLspNative,
  },
  {
    pluginId: "ai-tools-git-native",
    process: "renderer",
    module: aiToolsGitNative,
  },
  {
    pluginId: "ai-tools-containers-native",
    process: "renderer",
    module: aiToolsContainersNative,
  },
  {
    pluginId: "ai-tools-terminal-native",
    process: "renderer",
    module: aiToolsTerminalNative,
  },
  {
    pluginId: "ai-tools-files-native",
    process: "renderer",
    module: aiToolsFilesNative,
  },
  {
    pluginId: "ai-tools-browser-native",
    process: "renderer",
    module: aiToolsBrowserNative,
  },
  {
    pluginId: "ai-tools-workflows-native",
    process: "renderer",
    module: aiToolsWorkflowsNative,
  },
  {
    pluginId: "ai-tools-transcript-native",
    process: "renderer",
    module: aiToolsTranscriptNative,
  },
  {
    pluginId: "ai-tools-mcp-native",
    process: "renderer",
    module: aiToolsMcpNative,
  },
  {
    pluginId: "ai-tools-subagents-native",
    process: "renderer",
    module: aiToolsSubagentsNative,
  },
  {
    pluginId: "ai-tools-system-native",
    process: "renderer",
    module: aiToolsSystemNative,
  },
  {
    pluginId: "ai-inference-native",
    process: "renderer",
    module: aiInferenceNative,
  },
  {
    pluginId: "ai-speech-native",
    process: "renderer",
    module: aiSpeechNative,
  },
  {
    pluginId: "appearance-settings",
    process: "renderer",
    module: appearanceSettings,
  },
  {
    pluginId: "editor-settings",
    process: "renderer",
    module: editorSettings,
  },
  {
    pluginId: "general-settings",
    process: "renderer",
    module: generalSettings,
  },
  {
    pluginId: "terminal-settings",
    process: "renderer",
    module: terminalSettings,
  },
  {
    pluginId: "shortcuts-settings",
    process: "renderer",
    module: shortcutsSettings,
  },
  {
    pluginId: "languages-settings",
    process: "renderer",
    module: languagesSettings,
  },
  {
    pluginId: "lsp-native",
    process: "main",
    module: lspNative,
    snapshotResources: () => {
      let lspRuntimeActive = true;
      try {
        lspRuntime();
      } catch {
        lspRuntimeActive = false;
      }
      return {
        lspCapabilityActive: lspCapabilityActive(),
        lspConfigPathActive: lspConfigPathActive(),
        lspInstallRootActive: lspInstallRootActive(),
        lspManagerActive: lspManagerActive(),
        lspRuntimeActive,
      };
    },
  },
  { pluginId: "search-sidebar", process: "renderer", module: searchSidebar },
  { pluginId: "ports-sidebar", process: "renderer", module: portsSidebar },
  { pluginId: "mcp-rig-sync", process: "renderer", module: mcpRigSync },
  {
    pluginId: "mcp-native",
    process: "main",
    module: mcpNative,
    snapshotResources: () => ({
      mcpClients: mcpClients.size,
      mcpRuntimeActive: mcpRuntimeActive(),
    }),
  },
  {
    pluginId: "markdown-surface",
    process: "renderer",
    module: markdownSurface,
  },
  { pluginId: "about-native", process: "renderer", module: aboutNative },
  {
    pluginId: "onboarding-native",
    process: "renderer",
    module: onboardingNative,
  },
  {
    pluginId: "onboarding-ui-native",
    process: "renderer",
    module: onboardingUiNative,
  },
  {
    pluginId: "onboarding-content-native",
    process: "renderer",
    module: onboardingContentNative,
    fixtureCapabilities: {
      "onboarding.registry": (resources) =>
        registryFixture(resources, "onboarding.registry"),
    },
  },
  {
    pluginId: "command-palette-native",
    process: "renderer",
    module: commandPaletteNative,
  },
  { pluginId: "models-settings", process: "renderer", module: modelsSettings },
  { pluginId: "rigs-commands", process: "renderer", module: rigsCommands },
  {
    pluginId: "safe-recovery-native",
    process: "renderer",
    module: safeRecoveryNative,
  },
  { pluginId: "settings-native", process: "renderer", module: settingsNative },
  {
    pluginId: "statusbar-native",
    process: "renderer",
    module: statusbarNative,
  },
  { pluginId: "ui-shell-native", process: "renderer", module: uiShellNative },
  {
    pluginId: "ui-change-reveal-native",
    process: "renderer",
    module: uiChangeRevealNative,
  },
  {
    pluginId: "workspace-shell-native",
    process: "renderer",
    module: workspaceShellNative,
  },
  {
    pluginId: "workspace-tab-actions-native",
    process: "renderer",
    module: workspaceTabActionsNative,
  },
  {
    pluginId: "workspace-rig-workflows-native",
    process: "renderer",
    module: workspaceRigWorkflowsNative,
  },
  { pluginId: "agent-hooks-native", process: "main", module: agentHooksMain },
  {
    pluginId: "agent-hooks-native",
    process: "renderer",
    module: agentHooksRenderer,
  },
  {
    pluginId: "boot-diagnostics-native",
    process: "main",
    module: bootDiagnosticsNative,
  },
  {
    pluginId: "workspace-environment-native",
    process: "renderer",
    module: workspaceEnvironmentNative,
  },
  {
    pluginId: "workspace-rigs-native",
    process: "renderer",
    module: workspaceRigsNative,
  },
  {
    pluginId: "ssh-auto-connect",
    process: "renderer",
    module: sshAutoConnect,
  },
  {
    pluginId: "theme-file-editing",
    process: "renderer",
    module: themeFileEditing,
  },
  {
    pluginId: "terminal-workspace-footer-native",
    process: "renderer",
    module: terminalWorkspaceFooterNative,
  },
  {
    pluginId: "selection-ask-ai-native",
    process: "renderer",
    module: selectionAskAiNative,
  },
  {
    pluginId: "plugin-manager-native",
    process: "renderer",
    module: pluginManagerNative,
  },
  {
    pluginId: "mcp-tool-bridge",
    process: "renderer",
    module: mcpToolBridge,
  },
  { pluginId: "desktop-native", process: "main", module: desktopNativeMain },
  {
    pluginId: "desktop-native",
    process: "renderer",
    module: desktopNativeRenderer,
  },
  {
    pluginId: "ai-diff-surface",
    process: "renderer",
    module: aiDiffSurface,
    snapshotResources: () => {
      try {
        aiDiffRuntime();
        return { aiDiffRuntimeActive: true };
      } catch {
        return { aiDiffRuntimeActive: false };
      }
    },
  },
  {
    pluginId: "ai-context-artifacts-native",
    process: "main",
    module: aiContextArtifactsNative,
    fixtureCapabilities: {
      "storage.application": storageFixture,
    },
  },
  {
    pluginId: "ai-library-native",
    process: "main",
    module: aiLibraryNative,
    fixtureCapabilities: {
      "storage.application": storageFixture,
    },
  },
  {
    pluginId: "agent-activity-native",
    process: "renderer",
    module: agentActivityNative,
  },
  {
    pluginId: "agents-manager-native",
    process: "renderer",
    module: agentsManagerNative,
    snapshotResources: () => ({
      agentManagerRuntimeActive: agentManagerRuntimeActive(),
      agentManagerModels: agentManagerModels
        .map((model) => `${model.id}:${model.label}`)
        .join(","),
    }),
  },
  {
    pluginId: "editor-surface-native",
    process: "renderer",
    module: editorSurfaceNative,
    snapshotResources: () => {
      let editorRuntimeActive = true;
      try {
        editorRuntime();
      } catch {
        editorRuntimeActive = false;
      }
      return {
        editorNavigationRuntimeActive: editorNavigationRuntimeActive(),
        editorRuntimeActive,
      };
    },
  },
  {
    pluginId: "files-native",
    process: "main",
    module: filesNative,
    snapshotResources: () => ({
      filesWorkspaceRuntimeActive: filesWorkspaceRuntimeActive(),
    }),
  },
  {
    pluginId: "explorer-sidebar",
    process: "renderer",
    module: explorerSidebar,
    snapshotResources: () => {
      try {
        explorerRuntime();
        return { explorerRuntimeActive: true };
      } catch {
        return { explorerRuntimeActive: false };
      }
    },
  },
  {
    pluginId: "header-native",
    process: "renderer",
    module: headerNative,
    snapshotResources: () => {
      try {
        headerDependencies();
        return { headerRuntimeActive: true };
      } catch {
        return { headerRuntimeActive: false };
      }
    },
  },
  {
    pluginId: "history-native",
    process: "main",
    module: historyNative,
  },
  {
    pluginId: "preview-surface-native",
    process: "renderer",
    module: previewSurfaceNative,
  },
  {
    pluginId: "preferences-json",
    process: "main",
    module: preferencesJson,
    fixtureCapabilities: {
      "storage.application": storageFixture,
    },
  },
  {
    pluginId: "git-surface",
    process: "renderer",
    module: gitSurface,
    snapshotResources: () => {
      try {
        gitSurfaceRuntime();
        return { gitSurfaceRuntimeActive: true };
      } catch {
        return { gitSurfaceRuntimeActive: false };
      }
    },
  },
  {
    pluginId: "git-native",
    process: "main",
    module: gitNative,
    snapshotResources: () => ({ gitRuntimeActive: gitRuntimeActive() }),
  },
  {
    pluginId: "shortcuts-native",
    process: "renderer",
    module: shortcutsNative,
  },
  {
    pluginId: "shell-native",
    process: "main",
    module: shellNative,
    snapshotResources: () => ({
      shellWorkspaceRuntimeActive: shellWorkspaceRuntimeActive(),
    }),
  },
  {
    pluginId: "source-control-sidebar",
    process: "renderer",
    module: sourceControlSidebar,
    snapshotResources: () => {
      try {
        sourceControlRuntime();
        return { sourceControlRuntimeActive: true };
      } catch {
        return { sourceControlRuntimeActive: false };
      }
    },
  },
  {
    pluginId: "skills-panel-native",
    process: "renderer",
    module: skillsPanelNative,
    snapshotResources: () => ({
      skillsDetectorRuntimeActive: skillsDetectorRuntimeActive(),
      skillsFileRuntimeActive: skillsFileRuntimeActive(),
      skillsLibraryRuntimeActive: skillsLibraryRuntimeActive(),
    }),
  },
  {
    pluginId: "theme-native",
    process: "renderer",
    module: themeNative,
  },
  {
    pluginId: "trajectory-native",
    process: "renderer",
    module: trajectoryNative,
    snapshotResources: () => {
      try {
        getTrajectoryRuntime();
        return { trajectoryRuntimeActive: true };
      } catch {
        return { trajectoryRuntimeActive: false };
      }
    },
  },
  { pluginId: "session-native", process: "main", module: sessionNativeMain },
  { pluginId: "session-native", process: "renderer", module: sessionNativeRenderer },
  { pluginId: "session-query-native", process: "main", module: sessionQueryNative },
  {
    pluginId: "workflows-native",
    process: "renderer",
    module: workflowsNative,
  },
  {
    pluginId: "workspace-tabs-native",
    process: "renderer",
    module: workspaceTabsNative,
    snapshotResources: () => ({
      workspaceTabsRuntimeActive: workspaceTabsRuntimeActive(),
    }),
  },
  {
    pluginId: "ai-chat-native",
    process: "renderer",
    module: aiChatNative,
    fixtureCapabilities: {
      "storage.application": storageFixture,
    },
    snapshotResources: () => ({
      sessionRuntimeActive: sessionRuntimeActive(),
      chatRuntimeActive: chatRuntimeActive(),
      aiUiPreferencesActive: aiUiPreferencesActive(),
      aiPlatformRuntimeActive: aiPlatformRuntimeActive(),
      aiDockIntegrationsActive: aiDockIntegrationsActive(),
      aiNativeFilesActive: aiNativeFilesActive(),
      aiSpeechRuntimeActive: aiSpeechRuntimeActive(),
      aiAgentsStoreActive: aiAgentsStoreActive(),
      aiSettingsNavigationActive: aiSettingsNavigationActive(),
      aiBrowserPolicyActive: aiBrowserPolicyActive(),
      aiFileIconsActive: aiFileIconsActive(),
      aiAgentsViewActive: aiAgentsViewActive(),
      aiEditorNavigationActive: aiEditorNavigationActive(),
      aiCompactionRuntimeActive: aiCompactionRuntimeActive(),
      aiLocalAgentNotificationsActive: aiLocalAgentNotificationsActive(),
      aiToolContributions: aiToolContributionCount(),
      aiChats: aiChats.size,
      aiSeedMessages: aiSeedMessages.size,
      aiToolContexts: aiToolContexts.size,
    }),
  },
  {
    pluginId: "browser-native",
    process: "main",
    module: browserNative,
    snapshotResources: () => ({
      browserCapabilityActive: browserCapabilityActive(),
      browserEventsActive: browserEventsActive(),
      browserAiHandlers: browserAiHandlerCount(),
      browserViews: liveBrowserViews().length,
    }),
  },
  {
    pluginId: "coding-agent-native",
    process: "main",
    module: codingAgentMain,
    snapshotResources: () => ({
      codingAgentRuntimeActive: codingAgentRuntimeActive(),
      codingAgentSessionJournalActive: codingAgentSessionJournalActive(),
      ...codingAgentLifecycleResources(),
    }),
  },
  {
    pluginId: "coding-agent-native",
    process: "renderer",
    module: codingAgentRenderer,
    snapshotResources: () => ({
      codingAgentUiRuntimeActive: codingAgentUiRuntimeActive(),
    }),
  },
  {
    pluginId: "containers-native",
    process: "main",
    module: containersMain,
  },
  {
    pluginId: "containers-native",
    process: "renderer",
    module: containersRenderer,
    snapshotResources: () => ({
      containersNativeActive: containersNativeActive(),
      containerIntegrationsActive: containerIntegrationsActive(),
    }),
  },
  {
    pluginId: "managed-agent-runtime-native",
    process: "renderer",
    module: managedAgentRuntimeNative,
  },
  {
    pluginId: "pty-native",
    process: "main",
    module: ptyNative,
    snapshotResources: () => ({
      ptyCapabilityActive: ptyCapabilityActive(),
      ptySessionsConfigured: ptySessionsConfigured(),
      ptySessions: livePtySessions().length,
    }),
  },
  {
    pluginId: "ssh-native",
    process: "main",
    module: sshNative,
    snapshotResources: () => ({
      sshCapabilityActive: sshCapabilityActive(),
      sshEventsActive: sshEventsActive(),
      sshReadyObservers: sshReadyObserverCount(),
      sshConnections: liveConnections().length,
    }),
  },
  {
    pluginId: "terminal-surface-native",
    process: "renderer",
    module: terminalSurfaceNative,
    snapshotResources: () => {
      let terminalRuntimeActive = true;
      try {
        terminalRuntime();
      } catch {
        terminalRuntimeActive = false;
      }
      return {
        terminalRuntimeActive,
        terminalTabsRuntimeActive: tabsRuntime() !== null,
        terminalSessionsConfigured: terminalSessionsConfigured(),
        terminalPaneSessions: terminalSessions.leafIds().length,
      };
    },
  },
  { pluginId: "updater-native", process: "main", module: updaterMain },
  {
    pluginId: "updater-native",
    process: "renderer",
    module: updaterRenderer,
    snapshotResources: () => ({ updaterStates: updaterStateCount() }),
  },
];

const defaultProfilePluginIds = (
  JSON.parse(
    readFileSync(join(process.cwd(), "profiles/default/profile.json"), "utf8"),
  ) as { plugins: Array<{ id: string }> }
).plugins.map((plugin) => plugin.id);

describe("default plugin deactivation contract", () => {
  it("covers every default plugin with a real-entrypoint lifecycle subject", () => {
    const certifiedPluginIds = new Set(
      subjects.map((subject) => subject.pluginId),
    );
    expect(new Set(defaultProfilePluginIds).size).toBe(
      defaultProfilePluginIds.length,
    );
    expect(
      defaultProfilePluginIds.filter(
        (pluginId) => !certifiedPluginIds.has(pluginId),
      ),
    ).toEqual([]);
  });

  it("keeps only the four recovery-critical plugins protected", () => {
    expect([...essentialPluginReasons]).toEqual([
      [
        "ui-shell-native",
        "It renders the application window; disabling it would leave no UI to recover from.",
      ],
      [
        "workspace-shell-native",
        "It hosts the workspace and settings surfaces; disabling it would blank the window.",
      ],
      [
        "settings-native",
        "It hosts Plugin Manager; disabling it would remove the UI needed to re-enable plugins.",
      ],
      [
        "plugin-manager-native",
        "It provides this manager; disabling it would remove the UI needed to re-enable itself.",
      ],
    ]);
    expect(
      defaultProfilePluginIds.filter((pluginId) =>
        essentialPluginReasons.has(pluginId),
      ),
    ).toHaveLength(4);
    expect(
      defaultProfilePluginIds.filter(
        (pluginId) => !essentialPluginReasons.has(pluginId),
      ),
    ).toHaveLength(
      defaultProfilePluginIds.length - essentialPluginReasons.size,
    );
  });
});

function treeFor(subject: Subject): ResolvedPluginTree {
  const manifest: TermcoPluginManifestV3 = {
    schemaVersion: 3,
    id: subject.pluginId,
    name: subject.pluginId,
    description: `Lifecycle fixture for ${subject.pluginId}`,
    category: "Lifecycle certification",
    version: "1.0.0",
    entrypoints: { [subject.process]: "fixture.ts" },
    dependencies: {},
  };
  return {
    profileId: `lifecycle.${subject.pluginId}`,
    plugins: [
      {
        id: subject.pluginId,
        manifest,
        source: {
          type: "local",
          module: `./plugins/${subject.pluginId}`,
          location: `plugins/${subject.pluginId}`,
        },
      },
    ],
    activationOrder: [subject.pluginId],
  };
}

interface FixtureResources {
  subscriptions: number;
  storageHandles: Map<string, number>;
  registryContributions: Map<string, number>;
}

function storageFixture(resources: FixtureResources): unknown {
  const data = new Map<string, Map<string, unknown>>();
  return {
    async open(path: string) {
      resources.storageHandles.set(
        path,
        (resources.storageHandles.get(path) ?? 0) + 1,
      );
      const values = data.get(path) ?? new Map<string, unknown>();
      data.set(path, values);
      return {
        get: <T>(key: string) => values.get(key) as T | undefined,
        set: (key: string, value: unknown) => values.set(key, value),
        delete: (key: string) => values.delete(key),
        entries: () => values.entries(),
        save: async () => {},
      };
    },
    async close(path: string) {
      const count = resources.storageHandles.get(path) ?? 0;
      if (count <= 1) resources.storageHandles.delete(path);
      else resources.storageHandles.set(path, count - 1);
    },
  };
}

const registryFixtureServices = new Set([
  "ui.commands",
  "ui.tabs.kinds",
  "ui.settings.sections",
  "ui.header.items",
  "ui.statusbar.items",
  "ui.sidebar.views",
  "ui.workspace.views",
  "ui.ai-dock.views",
  "ui.overlays",
  "ui.background.tasks",
  "ai.tools",
  "ai.toolsets",
  "ai.live-contributions",
  "workspace.tab-close-guards",
  "workflows.definitions",
]);

function registryFixture(
  resources: FixtureResources,
  capability: string,
  initial: readonly unknown[] = [],
): unknown {
  const entries = [...initial];
  const listeners = new Set<() => void>();
  const register = (entry: unknown) => {
    entries.push(entry);
    resources.registryContributions.set(
      capability,
      (resources.registryContributions.get(capability) ?? 0) + 1,
    );
    for (const listener of listeners) listener();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
      const contributionCount =
        (resources.registryContributions.get(capability) ?? 1) - 1;
      if (contributionCount === 0) {
        resources.registryContributions.delete(capability);
      } else {
        resources.registryContributions.set(capability, contributionCount);
      }
      for (const listener of listeners) listener();
    };
  };
  return {
    register,
    contribute: register,
    snapshot: () => [...entries],
    subscribe(listener: () => void) {
      listeners.add(listener);
      resources.subscriptions += 1;
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        resources.subscriptions -= 1;
      };
    },
  };
}

function fixtureCapability(
  capability: string,
  resources: FixtureResources,
): unknown {
  if (capability === "kernel.process-transport") {
    let nextChannel = 0;
    const channels = new Set<number>();
    return {
      hostControl: fixtureCapability("kernel.host-control", resources),
      call: async () => ({ __termcoDispose: "lifecycle-fixture" }),
      registerChannel: () => {
        const channel = ++nextChannel;
        channels.add(channel);
        resources.subscriptions += 1;
        return { __termcoChannel: channel };
      },
      releaseChannel: (channel: { __termcoChannel: number }) => {
        if (!channels.delete(channel.__termcoChannel)) return;
        resources.subscriptions -= 1;
      },
      releaseRemote: async () => {},
    };
  }
  if (capability === "storage.application") {
    return storageFixture(resources);
  }
  if (capability === "ai.models") {
    return registryFixture(resources, capability, [
      {
        id: "fixture",
        name: "Fixture",
        description: "Lifecycle fixture",
        kind: "local",
        keyRequirement: "none",
        models: [{ id: "fixture:model", label: "Fixture model" }],
      },
    ]);
  }
  if (registryFixtureServices.has(capability)) {
    return registryFixture(resources, capability);
  }
  if (capability === "terminal.workspace-footer") {
    return {
      create: () => ({
        id: "terminal-block-input",
        label: "Terminal block input",
        description: "Lifecycle fixture footer",
        Component: () => null,
      }),
    };
  }
  if (capability === "mcp.server") {
    return {
      invoke: async () => ({ ok: true }),
      liveResources: () => [],
      setRunApprovalHandler: () => {},
      setRunFullAutoResolver: () => {},
    };
  }
  let proxy: unknown;
  const callable = (): unknown => proxy;
  proxy = new Proxy(callable, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === Symbol.iterator) return function* iterator() {};
      if (
        typeof property === "string" &&
        (/^subscribe/.test(property) ||
          /^on[A-Z]/.test(property) ||
          property === "contribute")
      ) {
        return () => {
          resources.subscriptions += 1;
          let disposed = false;
          return () => {
            if (disposed) return;
            disposed = true;
            resources.subscriptions -= 1;
          };
        };
      }
      return proxy;
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

function moduleWithFixtureLookups(
  subject: Subject,
  resources: FixtureResources,
): PluginModule {
  return {
    inject: subject.module.inject,
    optionalInject: subject.module.optionalInject,
    replacementImpact: subject.module.replacementImpact?.bind(subject.module),
    activate(context) {
      const fixtureContext: PluginActivationContext = {
        ...context,
        get<T>(service: string): T {
          const provided = context.get<T>(service);
          if (provided !== undefined) return provided;
          return (subject.fixtureCapabilities?.[service]?.(resources) ??
            fixtureCapability(service, resources)) as T;
        },
      };
      return subject.module.activate(fixtureContext);
    },
  };
}

function createRuntime(
  tree: ResolvedPluginTree,
  resources: FixtureResources,
  subject: Subject,
): CapabilityRuntime {
  const runtime = new CapabilityRuntime(tree);
  for (const service of new Set([
    ...(subject.module.inject ?? []),
    ...(subject.module.optionalInject ?? []),
  ])) {
    if (service === kernelEventsService) continue;
    runtime.installExternalCapability(
      service,
      service === "kernel.process-transport"
        ? "kernel"
        : `lifecycle-fixture:${service}`,
      subject.fixtureCapabilities?.[service]?.(resources) ??
        fixtureCapability(service, resources),
    );
  }
  return runtime;
}

describe("source plugin lifecycle certification", () => {
  for (const subject of subjects) {
    it(`${subject.pluginId} passes §3.4 through its real entrypoint`, async () => {
      vi.useFakeTimers();
      const resources: FixtureResources = {
        subscriptions: 0,
        storageHandles: new Map(),
        registryContributions: new Map(),
      };
      const host = window as unknown as {
        __termco?: { e2e?: boolean };
        __termcoE2E?: Record<string, unknown>;
      };
      const previousTermco = host.__termco;
      const previousE2E = host.__termcoE2E;
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }));
      const originalAddEventListener = window.addEventListener.bind(window);
      const originalRemoveEventListener =
        window.removeEventListener.bind(window);
      const windowListeners: Array<{
        type: string;
        listener: EventListenerOrEventListenerObject;
        options?: boolean | AddEventListenerOptions;
      }> = [];
      window.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        windowListeners.push({ type, listener, options });
        originalAddEventListener(type, listener, options);
      }) as typeof window.addEventListener;
      window.removeEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        const capture =
          typeof options === "boolean" ? options : (options?.capture ?? false);
        const index = windowListeners.findIndex((entry) => {
          const entryCapture =
            typeof entry.options === "boolean"
              ? entry.options
              : (entry.options?.capture ?? false);
          return (
            entry.type === type &&
            entry.listener === listener &&
            entryCapture === capture
          );
        });
        if (index >= 0) windowListeners.splice(index, 1);
        originalRemoveEventListener(type, listener, options);
      }) as typeof window.removeEventListener;
      host.__termco = { ...previousTermco, e2e: true };
      host.__termcoE2E = {};
      try {
        const tree = treeFor(subject);
        await certifyPluginLifecycle({
          pluginId: subject.pluginId,
          module: moduleWithFixtureLookups(subject, resources),
          createRuntime: () => createRuntime(tree, resources, subject),
          snapshotResources: () => ({
            timers: vi.getTimerCount(),
            fixtureSubscriptions: resources.subscriptions,
            storageHandles: [...resources.storageHandles]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([path, count]) => `${path}:${count}`)
              .join(","),
            registryContributions: [...resources.registryContributions]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([capability, count]) => `${capability}:${count}`)
              .join(","),
            windowListeners: windowListeners.length,
            windowChildren:
              typeof document === "undefined"
                ? 0
                : document.body.childElementCount,
            e2eKeys: Object.keys(host.__termcoE2E ?? {})
              .sort()
              .join(","),
            headChildren:
              typeof document === "undefined"
                ? 0
                : document.head.childElementCount,
            powerResumeListeners: privilegedResources.powerResumeListeners,
            updateDownloadListeners:
              privilegedResources.updateDownloadListeners,
            updateFinishedListeners:
              privilegedResources.updateFinishedListeners,
            watchers: privilegedResources.watchers,
            ptys: privilegedResources.ptys,
            processExitListeners: process.listenerCount("exit"),
            ...subject.snapshotResources?.(),
          }),
        });
      } finally {
        for (const entry of windowListeners) {
          originalRemoveEventListener(
            entry.type,
            entry.listener,
            entry.options,
          );
        }
        window.addEventListener = originalAddEventListener;
        window.removeEventListener = originalRemoveEventListener;
        window.matchMedia = originalMatchMedia;
        host.__termco = previousTermco;
        host.__termcoE2E = previousE2E;
        vi.useRealTimers();
      }
    });
  }
});

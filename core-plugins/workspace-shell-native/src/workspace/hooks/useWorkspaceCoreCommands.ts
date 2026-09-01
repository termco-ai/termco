/** Workspace-owned command-palette entries. The source is installed once and
 * reads current render state lazily whenever the palette opens. */
import { MAX_PANES_PER_TAB, type Tab } from "../tabs";
import { leafIds } from "../tabs/lib/panes";
import {
  AiNetworkIcon,
  Cancel01Icon,
  KeyboardIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  Search01Icon,
  Settings01Icon,
  SidebarLeftIcon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import type { UiCommandItem } from "@termco/ui-commands-base";
import type { UiHeaderFindTarget } from "@termco/ui-header-base";
import { useEffect, useRef } from "react";
import type { WorkspaceCommandCatalog } from "../commandCatalog";

export type WorkspaceCoreCommandParams = {
  tabs: Tab[];
  activeId: number;
  searchTarget: UiHeaderFindTarget | null;
  openNewTab: () => void;
  closeActiveTabOrPane: () => void;
  splitPaneRight: () => void;
  splitPaneDown: () => void;
  focusSearch: () => void;
  toggleSidebar: () => void;
  toggleAi: () => void;
  askAiSelection: () => void;
  openSettings: (sectionId?: string) => void;
  openAgents: () => void;
};

/** Build the workspace-owned entries, including current disable reasons. */
function buildWorkspaceCoreItems(
  p: WorkspaceCoreCommandParams,
): UiCommandItem[] {
  const activeTab = p.tabs.find((tab) => tab.id === p.activeId);
  const activeTerminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const activePaneCount = activeTerminalTab
    ? leafIds(activeTerminalTab.paneTree).length
    : 0;
  const onlyOneTab = p.tabs.length < 2;
  const splitDisabled = !activeTerminalTab
    ? "No terminal tab"
    : activePaneCount >= MAX_PANES_PER_TAB
      ? "Pane limit"
      : undefined;
  const closeDisabled =
    onlyOneTab && activePaneCount < 2 ? "Last tab" : undefined;

  return [
    {
      id: "settings.open",
      title: "Open settings",
      description: "Open application settings and plugin configuration.",
      group: "General",
      keywords: ["preferences", "config"],
      icon: Settings01Icon,
      shortcutId: "settings.open",
      run: () => p.openSettings(),
    },
    {
      id: "shortcuts.open",
      title: "Keyboard shortcuts",
      description: "View and edit keyboard shortcuts.",
      group: "General",
      keywords: ["keys", "keybindings", "settings"],
      icon: KeyboardIcon,
      run: () => p.openSettings("shortcuts"),
    },
    {
      id: "tab.new",
      title: "New terminal",
      description: "Open a terminal tab in the active rig.",
      group: "Tabs",
      keywords: ["shell", "terminal", "new tab"],
      icon: TerminalIcon,
      shortcutId: "tab.new",
      run: p.openNewTab,
    },
    {
      id: "tab.close",
      title: "Close tab or pane",
      description: "Close the active pane, or its tab when it is the last pane.",
      group: "Tabs",
      keywords: ["close", "remove", "pane"],
      icon: Cancel01Icon,
      shortcutId: "tab.close",
      disabledReason: closeDisabled,
      run: p.closeActiveTabOrPane,
    },
    {
      id: "pane.splitRight",
      title: "Split pane right",
      description: "Add a terminal pane to the right of the active pane.",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "right", "column"],
      icon: LayoutTwoColumnIcon,
      shortcutId: "pane.splitRight",
      disabledReason: splitDisabled,
      run: p.splitPaneRight,
    },
    {
      id: "pane.splitDown",
      title: "Split pane down",
      description: "Add a terminal pane below the active pane.",
      group: "Panes",
      keywords: ["terminal", "pane", "split", "down", "row"],
      icon: LayoutTwoRowIcon,
      shortcutId: "pane.splitDown",
      disabledReason: splitDisabled,
      run: p.splitPaneDown,
    },
    {
      id: "search.focus",
      title: "Find in current tab",
      description: "Search within the active terminal, editor, or history view.",
      group: "Search",
      keywords: ["find", "terminal", "editor", "current"],
      icon: Search01Icon,
      shortcutId: "search.focus",
      disabledReason: p.searchTarget ? undefined : "No searchable view",
      run: p.focusSearch,
    },
    {
      id: "sidebar.toggle",
      title: "Toggle file explorer",
      description: "Show or hide the file explorer sidebar.",
      group: "View",
      keywords: ["sidebar", "files", "explorer"],
      icon: SidebarLeftIcon,
      shortcutId: "sidebar.toggle",
      run: p.toggleSidebar,
    },
    {
      id: "ai.toggle",
      title: "Toggle AI agent",
      description: "Show or hide the AI chat panel.",
      group: "AI",
      keywords: ["assistant", "chat", "agent"],
      icon: SparklesIcon,
      shortcutId: "ai.toggle",
      run: p.toggleAi,
    },
    {
      id: "ai.askSelection",
      title: "Ask AI about selection",
      description: "Send the current terminal or editor selection to AI chat.",
      group: "AI",
      keywords: ["selection", "explain", "assistant", "chat"],
      icon: SparklesIcon,
      shortcutId: "ai.askSelection",
      run: p.askAiSelection,
    },
    {
      id: "ai.manageAgents",
      title: "Open Agents",
      description: "Manage AI agents, instructions, snippets, and MCP servers.",
      group: "AI",
      keywords: ["agents", "snippets", "mcp", "personas", "manage"],
      icon: AiNetworkIcon,
      run: p.openAgents,
    },
  ];
}

/** Register the source once; the builder always reads the latest render's
 * params through the ref. */
export function useWorkspaceCoreCommands(
  params: WorkspaceCoreCommandParams,
  catalog: WorkspaceCommandCatalog,
): void {
  const ref = useRef(params);
  ref.current = params;
  useEffect(
    () => catalog.install(() => buildWorkspaceCoreItems(ref.current)),
    [catalog],
  );
}

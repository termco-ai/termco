import { DEFAULT_RIG_ID, type Tab, type useTabs } from "../tabs";
import { type AgentActivityCapability } from "@termco/agents-base";
import { type AiSessionsCapability } from "@termco/ai-sessions-base";
import { type EditorNavigationCapability, type EditorSessionsCapability } from "@termco/editor-base";
import {
  type ShortcutHandlers,
  type ShortcutId,
  type ShortcutRegistryCapability,
} from "@termco/shortcuts-base";
import { type TerminalSessionsCapability } from "@termco/terminal-base";
import { TOGGLE_BLOCK_INPUT_EVENT } from "@termco/ui-workspace-base";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
} from "react";

type TabsApi = ReturnType<typeof useTabs>;

type Params = Pick<TabsApi, "selectByIndex" | "focusNextPaneInTab"> & {
  activeId: number;
  activeRigId: string | null;
  activeTab: Tab | undefined;
  openNewTab: () => void;
  openNewBlockTab: () => void;
  openNewPrivateTab: () => void;
  openPreviewTab: (url: string) => number;
  handleCloseTabOrPane: () => void;
  cycleRig: (delta: 1 | -1) => void;
  setSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  splitActivePaneInActiveTab: (dir: "row" | "col") => void;
  toggleSourceControl: () => void;
  activateAgentTarget: (tabId: number, leafId: number) => void;
  toggleSidebar: () => void;
  toggleExplorerFocus: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  setZenMode: Dispatch<SetStateAction<boolean>>;
  captureActiveSelection: () => string | null;
  openSettings: (sectionId?: string) => void;
  aiSessions: AiSessionsCapability;
  agentActivity: AgentActivityCapability;
  shortcuts: ShortcutRegistryCapability;
  editorNavigation: EditorNavigationCapability;
  editorSessions: EditorSessionsCapability;
  terminalSessions: TerminalSessionsCapability;
  focusSearch: () => void;
};

/**
 * Wires every global keyboard shortcut to its handler and encodes the
 * context-sensitive disabling rules (editor undo/redo only in editors, ⌘K
 * clear only over a focused terminal, Ctrl+B deferring to the shell, …).
 */
export function useAppShortcuts({
  selectByIndex,
  focusNextPaneInTab,
  activeId,
  activeRigId,
  activeTab,
  openNewTab,
  openNewBlockTab,
  openNewPrivateTab,
  openPreviewTab,
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
  openSettings,
  aiSessions,
  agentActivity,
  shortcuts,
  editorNavigation,
  editorSessions,
  terminalSessions,
  focusSearch,
}: Params) {
  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "tab.new": openNewTab,
      "tab.newBlock": openNewBlockTab,
      "tab.newPrivate": openNewPrivateTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => editorNavigation.openNewFile(),
      "tab.close": handleCloseTabOrPane,
      "tab.selectByIndex": (e) =>
        selectByIndex(parseInt(e.key, 10) - 1, activeRigId ?? DEFAULT_RIG_ID),
      "rig.next": () => cycleRig(1),
      "rig.prev": () => cycleRig(-1),
      "rig.overview": () => setSwitcherOpen(true),
      "pane.splitRight": () => splitActivePaneInActiveTab("row"),
      "pane.splitDown": () => splitActivePaneInActiveTab("col"),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        terminalSessions.clearFocused();
      },
      "terminal.toggleInput": () =>
        window.dispatchEvent(new CustomEvent(TOGGLE_BLOCK_INPUT_EVENT)),
      "blocks.prev": () => terminalSessions.navigateFocusedBlocks(-1),
      "blocks.next": () => terminalSessions.navigateFocusedBlocks(1),
      // The inline search lives in the header plugin now (Phase 3 step 7) —
      // reach it through the narrow ring-2 `header` service at event time.
      "search.focus": focusSearch,
      "ai.toggle": () => aiSessions.togglePanel(),
      "ai.askSelection": () => {
        const sessions = aiSessions;
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
      "agent.focusAttention": () => {
        const t = agentActivity.nextAttentionTarget();
        if (t) activateAgentTarget(t.tabId, t.leafId);
      },
      "settings.open": () => openSettings(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorSessions.undo(activeId),
      "editor.redo": () => editorSessions.redo(activeId),
    }),
    [
      activeId,
      cycleRig,
      handleCloseTabOrPane,
      openNewTab,
      openNewBlockTab,
      openNewPrivateTab,
      openPreviewTab,
      activeRigId,
      selectByIndex,
      splitActivePaneInActiveTab,
      focusNextPaneInTab,
      toggleSourceControl,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
      activateAgentTarget,
      activeTab,
      editorNavigation,
      editorSessions,
      terminalSessions,
      focusSearch,
      captureActiveSelection,
      openSettings,
      aiSessions,
      agentActivity,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".terminal-host",
        );
        if (!inTerminal) return false;
        const sel = captureActiveSelection();
        return !sel || !sel.trim();
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".terminal-host");
      }
      if (
        id === "terminal.toggleInput" ||
        id === "blocks.prev" ||
        id === "blocks.next"
      ) {
        return !(activeTab?.kind === "terminal" && activeTab.blocks === true);
      }
      if (id === "sidebar.toggle") {
        // Ctrl+B is also a coding-agent "run in background" key. While a
        // terminal is focused, let Ctrl+B reach the shell instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".terminal-host",
        );
        // Only defer the plain (no-shift) Ctrl/⌘+B binding; the Shift variant
        // is the always-on toggle and is never claimed by the terminal.
        return inTerminal && !e.shiftKey;
      }
      return false;
    },
    [activeTab, captureActiveSelection],
  );

  shortcuts.useHandlers(shortcutHandlers, { isDisabled: shortcutsDisabled });
}

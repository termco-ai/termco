/**
 * Chrome derivations over the FOCUSED tab (plugin-rewrite Phase 3 step 9e —
 * active file path, terminal leaf cwd,
 * privacy/dirty flags, the header's search target, and raw selection capture
 * through the selected terminal/editor session capabilities.
 */
import type { Tab } from "../tabs";
import { findLeafCwd } from "../tabs/lib/panes";
import type { EditorSessionsCapability } from "@termco/editor-base";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import type { UiSurfaceSearchCapability } from "@termco/ui-tabs-base";
import { useCallback, useSyncExternalStore } from "react";

type Params = {
  tabs: Tab[];
  /** The chrome-active tab id (follows the FOCUSED split pane). */
  focusActiveId: number;
  /** The RAW active (left-pane) tab id — selection capture keys off this. */
  activeId: number;
  terminalSessions: TerminalSessionsCapability;
  editorSessions: EditorSessionsCapability;
  surfaceSearch: UiSurfaceSearchCapability;
};

export function useActiveTabDerived({
  tabs,
  focusActiveId,
  activeId,
  terminalSessions,
  editorSessions,
  surfaceSearch,
}: Params) {
  // The chrome-active tab follows the FOCUSED pane.
  const activeTab = tabs.find((t) => t.id === focusActiveId);
  const privateActive =
    activeTab?.kind === "terminal" && activeTab.private === true;
  const editorDirty = activeTab?.kind === "editor" && activeTab.dirty === true;

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;

  const searchTarget = useSyncExternalStore(
    (listener) => surfaceSearch.subscribe(listener),
    () => surfaceSearch.target(focusActiveId),
    () => null,
  );

  // Raw selection capture through the selected source-plugin capabilities.
  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      return terminalSessions.selection(t.activeLeafId);
    }
    if (t.kind === "editor") {
      return editorSessions.selection(activeId);
    }
    return null;
  }, [tabs, activeId, terminalSessions, editorSessions]);

  return {
    activeTab,
    privateActive,
    editorDirty,
    activeTerminalLeafCwd,
    activeFilePath,
    explorerActiveFilePath,
    searchTarget,
    captureActiveSelection,
  };
}

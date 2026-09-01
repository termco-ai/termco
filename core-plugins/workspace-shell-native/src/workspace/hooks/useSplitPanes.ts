/**
 * Derives the exact split-view presentation from the selected workspace.tabs
 * provider. The provider owns `splitTabId` and `focusedPane`; this consumer
 * only maps that public state to left/right surface lists and pane-aware open
 * behavior. Workspace chrome follows the focused pane while each surface renders
 * its own tab.
 */
import type { Tab } from "../tabs";
import { type RefObject, useCallback, useEffect, useMemo } from "react";

type Params = {
  tabs: Tab[];
  activeId: number;
  splitTabId: number;
  focusedPane: "left" | "right";
  setActiveId: (id: number) => void;
  setSplit: (id: number) => void;
  closeSplit: () => void;
  activeRigId: string | null;
  defaultRigId: string;
  tabsRef: RefObject<Tab[]>;
};

export function useSplitPanes({
  tabs,
  activeId,
  splitTabId,
  focusedPane,
  setActiveId,
  setSplit,
  closeSplit,
  activeRigId,
  defaultRigId,
  tabsRef,
}: Params) {
  const isSplit = splitTabId !== 0;
  const splitTab = tabs.find((t) => t.id === splitTabId);
  // Left pane = all tabs except the split tab (so each tab mounts in exactly
  // one surface); the left pane's active tab is `activeId`.
  const leftTabs = useMemo(
    () => (isSplit ? tabs.filter((t) => t.id !== splitTabId) : tabs),
    [tabs, isSplit, splitTabId],
  );
  const leftActiveTab = tabs.find((t) => t.id === activeId);
  // The focused tab drives the chrome.
  const focusActiveId =
    isSplit && focusedPane === "right" ? splitTabId : activeId;

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === focusActiveId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, focusActiveId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  // The split tab belongs to a rig; drop the split when the active rig no
  // longer matches it (e.g. the user switched rigs). Self-correcting, so a
  // restored split (whose tab IS in the active rig) is left intact.
  useEffect(() => {
    if (!splitTabId) return;
    const st = tabsRef.current.find((t) => t.id === splitTabId);
    if (st && st.rigId !== (activeRigId ?? defaultRigId)) closeSplit();
  }, [activeRigId, splitTabId, closeSplit, defaultRigId, tabsRef]);

  // Route tab creation to whichever pane is focused. New-tab actions always
  // make the fresh tab the active (left-pane) tab; when the split's RIGHT pane
  // is focused we redirect it into that pane instead and keep the left as-is.
  const openInFocusedPane = useCallback(
    (create: () => number): number => {
      if (!isSplit || focusedPane !== "right") return create();
      const prevLeft = activeId;
      const id = create(); // makes `id` the active/left tab
      if (id !== prevLeft) {
        setSplit(id); // move it into the right pane
        setActiveId(prevLeft); // restore the left pane's previous tab
      }
      return id;
    },
    [isSplit, focusedPane, activeId, setSplit, setActiveId],
  );

  return {
    isSplit,
    splitTab,
    leftTabs,
    leftActiveTab,
    focusActiveId,
    activeTerminalTab,
    activeLeafId,
    openInFocusedPane,
  };
}

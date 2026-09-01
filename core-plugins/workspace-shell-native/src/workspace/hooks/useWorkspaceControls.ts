import type { Tab, useTabs } from "../tabs";
import { leafIds } from "../tabs/lib/panes";
import type { WorkspaceRigsCapability } from "@termco/workspace-base";
import { type RefObject, useCallback, useState } from "react";

type TabsApi = ReturnType<typeof useTabs>;

type Params = Pick<
  TabsApi,
  | "newPreviewTab"
  | "splitActivePane"
  | "closeActivePane"
  | "setActiveId"
  | "focusPane"
> & {
  activeId: number;
  tabsRef: RefObject<Tab[]>;
  handleClose: (id: number) => void;
  rigs: WorkspaceRigsCapability;
};

/**
 * Pane/tab layout controls plus zen-mode chrome toggle and agent focusing:
 * opening preview tabs, splitting/closing the active pane, and jumping to an
 * agent's tab (switching to its rig first so chrome and pane stay aligned).
 */
export function useWorkspaceControls({
  newPreviewTab,
  splitActivePane,
  closeActivePane,
  setActiveId,
  focusPane,
  activeId,
  tabsRef,
  handleClose,
  rigs,
}: Params) {
  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      return id;
    },
    [newPreviewTab],
  );

  const splitActivePaneInActiveTab = useCallback(
    (dir: "row" | "col") => {
      const t = tabsRef.current.find((x) => x.id === activeId);
      if (!t || t.kind !== "terminal") return;
      splitActivePane(activeId, dir);
    },
    [activeId, splitActivePane],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  // Focus an agent's tab, switching to its rig first so the header and tab
  // strip don't end up showing a different rig than the focused pane.
  const activateAgentTarget = useCallback(
    (tabId: number, leafId: number) => {
      const rig = tabsRef.current.find((t) => t.id === tabId)?.rigId;
      if (rig && rig !== rigs.snapshot().activeId) {
        rigs.activate(rig);
      }
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane, rigs],
  );

  return {
    openPreviewTab,
    splitActivePaneInActiveTab,
    handleCloseTabOrPane,
    zenMode,
    setZenMode,
    activateAgentTarget,
  };
}

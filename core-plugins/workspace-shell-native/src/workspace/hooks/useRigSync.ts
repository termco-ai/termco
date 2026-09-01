import { DEFAULT_RIG_ID, type Tab, type useTabs } from "../tabs";
import type { PreferencesCapability } from "@termco/storage-base";
import type {
  WorkspaceCapability,
  WorkspaceEnv,
  WorkspaceRigsCapability,
  WorkspaceTabsCapability,
} from "@termco/workspace-base";
import { type RefObject, useEffect, useRef } from "react";
import { useRigPersistence } from "./useRigPersistence";
import { useRigsBoot } from "./useRigsBoot";

type TabsApi = ReturnType<typeof useTabs>;

type Params = Pick<
  TabsApi,
  | "tabs"
  | "activeId"
  | "splitTabId"
  | "setSplit"
  | "allocId"
  | "replaceTabs"
  | "markBooted"
  | "setActiveRigForNewTabs"
  | "activateRigTab"
> & {
  activeRigId: string | null;
  rigsHydrated: boolean;
  launchCwdResolved: boolean;
  launchCwd: string | null;
  home: string | null;
  tabsRef: RefObject<Tab[]>;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
  rigs: WorkspaceRigsCapability;
  workspaceTabs: WorkspaceTabsCapability;
  preferences: PreferencesCapability;
  workspaceRegistry: WorkspaceCapability;
};

/**
 * Bridges the tab workspace to the rigs store: boots the initial rig,
 * persists tab/rig state, follows the active-rig pointer (adopting its
 * env and restoring its last-active tab).
 */
export function useRigSync({
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
  rigs,
  workspaceTabs,
  preferences,
  workspaceRegistry,
}: Params) {
  useRigsBoot({
    ready: launchCwdResolved,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    setSplit,
    markBooted,
    setActiveRigForNewTabs,
    adoptWorkspaceEnv,
    rigs,
    workspaceTabs,
    preferences,
    workspaceRegistry,
  });

  useRigPersistence({
    tabs,
    activeId,
    splitTabId,
    activeRigId: activeRigId ?? DEFAULT_RIG_ID,
    enabled: rigsHydrated,
    workspaceTabs,
  });

  const prevRigRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!rigsHydrated || !activeRigId) return;
    const prev = prevRigRef.current;
    prevRigRef.current = activeRigId;
    if (prev == null) {
      setActiveRigForNewTabs(activeRigId);
      return;
    }
    if (prev === activeRigId) return;
    const meta = rigs.snapshot().rigs.find((s) => s.id === activeRigId);
    if (meta) void adoptWorkspaceEnv(meta.workspace);
    const inRig = tabsRef.current.filter((t) => t.rigId === activeRigId);
    if (inRig.length === 0) {
      activateRigTab(activeRigId);
      return;
    }
    // Keep the active tab if it already belongs to the newly active rig (a
    // cross-rig jump set it explicitly); else fall to the rig's last tab.
    const tabId = inRig.some((t) => t.id === activeId)
      ? activeId
      : inRig[inRig.length - 1].id;
    activateRigTab(activeRigId, tabId);
  }, [
    activeRigId,
    activeId,
    rigsHydrated,
    setActiveRigForNewTabs,
    activateRigTab,
    adoptWorkspaceEnv,
    rigs,
  ]);
}

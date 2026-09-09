import type { Tab } from "../tabs";
import type { WorkspaceTabsCapability, WorkspaceRigsCapability } from "@termco/workspace-base";
import { useCallback, useEffect, useRef } from "react";
import { isSerializableTab, serializeTabs } from "../lib/rigSerialization";

const DEBOUNCE_MS = 3000;

type Snapshot = {
  tabs: Tab[];
  activeId: number;
  splitTabId: number;
  splitDirection?: "horizontal" | "vertical";
  splitPlacement?: "before" | "after";
  activeRigId: string;
};

type Params = Snapshot & {
  enabled: boolean;
  workspaceTabs: WorkspaceTabsCapability;
  rigs?: WorkspaceRigsCapability;
};

type LastWrite = {
  json: string;
  activeTabIndex: number;
  splitTabIndex: number;
  splitDirection?: "horizontal" | "vertical";
  splitPlacement?: "before" | "after";
};

export function useRigPersistence({
  tabs,
  activeId,
  splitTabId,
  splitDirection,
  splitPlacement,
  activeRigId,
  enabled,
  workspaceTabs,
  rigs,
}: Params) {
  const last = useRef<Map<string, LastWrite>>(new Map());
  const seeded = useRef(false);
  // Only clear layouts whose tabs have actually been loaded by this shell.
  const observedRigs = useRef(new Set<string>());
  if (enabled) for (const tab of tabs) observedRigs.current.add(tab.rigId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Snapshot>({ tabs, activeId, splitTabId, splitDirection, splitPlacement, activeRigId });
  latest.current = { tabs, activeId, splitTabId, splitDirection, splitPlacement, activeRigId };

  if (enabled && !seeded.current) {
    seeded.current = true;
    for (const layout of workspaceTabs.savedLayouts()) {
      last.current.set(layout.rigId, {
        json: JSON.stringify(layout.tabs),
        activeTabIndex: layout.activeTabIndex,
        splitTabIndex: layout.splitTabIndex,
        splitDirection: layout.splitDirection,
        splitPlacement: layout.splitPlacement,
      });
    }
  }

  const flush = useCallback(
    (snapshot: Snapshot) => {
      const groups = new Map<string, Tab[]>();
      for (const tab of snapshot.tabs) {
        const group = groups.get(tab.rigId);
        if (group) group.push(tab);
        else groups.set(tab.rigId, [tab]);
      }

      for (const rigId of observedRigs.current) {
        if (!groups.has(rigId)) groups.set(rigId, []);
      }
      for (const [rigId, group] of groups) {
        if (rigs && !rigs.snapshot().rigs.some((rig) => rig.id === rigId)) {
          last.current.delete(rigId);
          observedRigs.current.delete(rigId);
          continue;
        }
        const serialized = serializeTabs(group);
        const previous = last.current.get(rigId);
        let activeTabIndex = previous?.activeTabIndex ?? 0;
        let splitTabIndex = previous?.splitTabIndex ?? -1;
        let savedDirection = previous?.splitDirection;
        let savedPlacement = previous?.splitPlacement;
        if (rigId === snapshot.activeRigId) {
          savedDirection = snapshot.splitDirection;
          savedPlacement = snapshot.splitPlacement;
          const serializable = group.filter(isSerializableTab);
          const activeIndex = serializable.findIndex(
            (tab) => tab.id === snapshot.activeId,
          );
          if (activeIndex >= 0) activeTabIndex = activeIndex;
          splitTabIndex = snapshot.splitTabId
            ? serializable.findIndex((tab) => tab.id === snapshot.splitTabId)
            : -1;
        }
        if (serialized.length === 0) {
          activeTabIndex = 0;
          splitTabIndex = -1;
        }
        const json = JSON.stringify(serialized);
        if (
          previous &&
          previous.json === json &&
          previous.activeTabIndex === activeTabIndex &&
          previous.splitTabIndex === splitTabIndex &&
          (previous.splitDirection ?? "horizontal") === (savedDirection ?? "horizontal") &&
          (previous.splitPlacement ?? "after") === (savedPlacement ?? "after")
        ) {
          continue;
        }
        last.current.set(rigId, { json, activeTabIndex, splitTabIndex, splitDirection: savedDirection, splitPlacement: savedPlacement });
        void workspaceTabs.saveLayout({
          rigId,
          tabs: serialized,
          activeTabIndex,
          splitTabIndex,
          ...(savedDirection ? { splitDirection: savedDirection } : {}),
          ...(savedPlacement ? { splitPlacement: savedPlacement } : {}),
        });
      }
    },
    [workspaceTabs, rigs],
  );

  useEffect(() => {
    if (!enabled) return;
    const snapshot: Snapshot = { tabs, activeId, splitTabId, splitDirection, splitPlacement, activeRigId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flush(snapshot);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs, activeId, splitTabId, splitDirection, splitPlacement, activeRigId, enabled, flush]);

  useEffect(() => {
    if (!enabled) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush(latest.current);
    };
    const onLeave = () => flush(latest.current);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      flush(latest.current);
    };
  }, [enabled, flush]);
}

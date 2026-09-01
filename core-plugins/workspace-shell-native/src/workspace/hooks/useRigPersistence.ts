import type { Tab } from "../tabs";
import type { WorkspaceTabsCapability } from "@termco/workspace-base";
import { useCallback, useEffect, useRef } from "react";
import { isSerializableTab, serializeTabs } from "../lib/rigSerialization";

const DEBOUNCE_MS = 3000;

type Snapshot = {
  tabs: Tab[];
  activeId: number;
  splitTabId: number;
  activeRigId: string;
};

type Params = Snapshot & {
  enabled: boolean;
  workspaceTabs: WorkspaceTabsCapability;
};

type LastWrite = {
  json: string;
  activeTabIndex: number;
  splitTabIndex: number;
};

export function useRigPersistence({
  tabs,
  activeId,
  splitTabId,
  activeRigId,
  enabled,
  workspaceTabs,
}: Params) {
  const last = useRef<Map<string, LastWrite>>(new Map());
  const seeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Snapshot>({ tabs, activeId, splitTabId, activeRigId });
  latest.current = { tabs, activeId, splitTabId, activeRigId };

  if (enabled && !seeded.current) {
    seeded.current = true;
    for (const layout of workspaceTabs.savedLayouts()) {
      last.current.set(layout.rigId, {
        json: JSON.stringify(layout.tabs),
        activeTabIndex: layout.activeTabIndex,
        splitTabIndex: layout.splitTabIndex,
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

      for (const [rigId, group] of groups) {
        const serialized = serializeTabs(group);
        const previous = last.current.get(rigId);
        let activeTabIndex = previous?.activeTabIndex ?? 0;
        let splitTabIndex = previous?.splitTabIndex ?? -1;
        if (rigId === snapshot.activeRigId) {
          const serializable = group.filter(isSerializableTab);
          const activeIndex = serializable.findIndex(
            (tab) => tab.id === snapshot.activeId,
          );
          if (activeIndex >= 0) activeTabIndex = activeIndex;
          splitTabIndex = snapshot.splitTabId
            ? serializable.findIndex((tab) => tab.id === snapshot.splitTabId)
            : -1;
        }
        const json = JSON.stringify(serialized);
        if (
          previous &&
          previous.json === json &&
          previous.activeTabIndex === activeTabIndex &&
          previous.splitTabIndex === splitTabIndex
        ) {
          continue;
        }
        last.current.set(rigId, { json, activeTabIndex, splitTabIndex });
        void workspaceTabs.saveLayout({
          rigId,
          tabs: serialized,
          activeTabIndex,
          splitTabIndex,
        });
      }
    },
    [workspaceTabs],
  );

  useEffect(() => {
    if (!enabled) return;
    const snapshot: Snapshot = { tabs, activeId, splitTabId, activeRigId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flush(snapshot);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs, activeId, splitTabId, activeRigId, enabled, flush]);

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

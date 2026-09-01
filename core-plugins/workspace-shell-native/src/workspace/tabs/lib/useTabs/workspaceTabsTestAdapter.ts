import type { PreferencesCapability } from "@termco/storage-base";
import type {
  WorkspaceRigTabLayout,
  WorkspaceTabMoveResult,
  WorkspaceTabRecord,
  WorkspaceTabsCapability,
  WorkspaceTabsSnapshot,
  WorkspaceTabsTransition,
} from "@termco/workspace-base";

/** Test-only in-memory adapter for the public workspace.tabs seam. */
export class WorkspaceTabsStore implements WorkspaceTabsCapability {
  private listeners = new Set<() => void>();
  private nextId = 1;
  private state: WorkspaceTabsSnapshot = {
    revision: 0,
    initialized: false,
    tabs: [],
    activeId: 0,
    splitTabId: 0,
    focusedPane: "left",
    booted: false,
    activeRigIdForNewTabs: "default",
    activeTabByRig: {},
  };

  constructor(_preferences: PreferencesCapability) {}

  snapshot(): WorkspaceTabsSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(next: WorkspaceTabsTransition): void {
    if (!this.state.initialized) this.commit(next, true);
  }

  allocate(count = 1): readonly number[] {
    return Array.from({ length: count }, () => this.nextId++);
  }

  transition(next: WorkspaceTabsTransition): void {
    this.commit(next, true);
  }

  nextActiveInRig(closingId: number): number | null {
    const closing = this.state.tabs.find((tab) => tab.id === closingId);
    if (!closing) return null;
    const sameRig = this.state.tabs.filter((tab) => tab.rigId === closing.rigId);
    if (sameRig.length <= 1) return null;
    const index = sameRig.findIndex((tab) => tab.id === closingId);
    return (sameRig[index - 1] ?? sameRig[index + 1]).id;
  }

  selectByRigIndex(index: number, rigId: string): number | null {
    const tab = this.state.tabs.filter((candidate) => candidate.rigId === rigId)[
      index
    ];
    if (!tab) return null;
    this.commit({ activeId: tab.id }, true);
    return tab.id;
  }

  close(tabId: number): boolean {
    if (!this.state.tabs.some((tab) => tab.id === tabId)) return false;
    const next = this.nextActiveInRig(tabId);
    this.commit(
      {
        tabs: this.state.tabs.filter((tab) => tab.id !== tabId),
        ...(this.state.activeId === tabId ? { activeId: next ?? 0 } : {}),
        ...(this.state.splitTabId === tabId ? { splitTabId: 0 } : {}),
      },
      true,
    );
    return true;
  }

  moveToRig(tabId: number, rigId: string): WorkspaceTabMoveResult {
    const moved = this.state.tabs.find((tab) => tab.id === tabId);
    if (!moved || moved.rigId === rigId) {
      return { changed: false, followTargetRig: false };
    }
    const fallback = this.nextActiveInRig(tabId);
    const activeMoved = this.state.activeId === tabId;
    this.commit(
      {
        tabs: this.state.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, rigId } : tab,
        ),
        ...(activeMoved && fallback !== null ? { activeId: fallback } : {}),
        ...(this.state.splitTabId === tabId ? { splitTabId: 0 } : {}),
      },
      true,
    );
    return {
      changed: true,
      followTargetRig: activeMoved && fallback === null,
    };
  }

  reorderAcrossRigs(
    tabId: number,
    targetTabId: number,
    edge: "top" | "bottom",
  ): WorkspaceTabMoveResult {
    const moved = this.state.tabs.find((tab) => tab.id === tabId);
    const target = this.state.tabs.find((tab) => tab.id === targetTabId);
    if (!moved || !target || moved.id === target.id) {
      return { changed: false, followTargetRig: false };
    }
    const crossRig = moved.rigId !== target.rigId;
    const fallback = crossRig ? this.nextActiveInRig(tabId) : null;
    const activeMoved = this.state.activeId === tabId;
    const tabs = this.state.tabs.filter((tab) => tab.id !== tabId);
    let targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);
    if (edge === "bottom") targetIndex += 1;
    tabs.splice(targetIndex, 0, crossRig ? { ...moved, rigId: target.rigId } : moved);
    this.commit(
      {
        tabs,
        ...(crossRig && activeMoved && fallback !== null
          ? { activeId: fallback }
          : {}),
        ...(crossRig && this.state.splitTabId === tabId
          ? { splitTabId: 0 }
          : {}),
      },
      true,
    );
    return {
      changed: true,
      followTargetRig: crossRig && activeMoved && fallback === null,
    };
  }

  reorderByGap(tabId: number, gap: number): boolean {
    const moved = this.state.tabs.find((tab) => tab.id === tabId);
    if (!moved) return false;
    const sameRig = this.state.tabs.filter((tab) => tab.rigId === moved.rigId);
    const from = sameRig.findIndex((tab) => tab.id === tabId);
    const to = Math.max(
      0,
      Math.min(gap > from ? gap - 1 : gap, sameRig.length - 1),
    );
    if (to === from) return false;
    const anchor = sameRig[to];
    const tabs = this.state.tabs.filter((tab) => tab.id !== tabId);
    const anchorIndex = tabs.findIndex((tab) => tab.id === anchor.id);
    tabs.splice(to > from ? anchorIndex + 1 : anchorIndex, 0, moved);
    this.commit({ tabs }, true);
    return true;
  }

  savedLayouts(): readonly WorkspaceRigTabLayout[] {
    return [];
  }

  async saveLayout(_layout: WorkspaceRigTabLayout): Promise<void> {}

  async deleteLayout(_rigId: string): Promise<void> {}

  private commit(next: WorkspaceTabsTransition, initialized: boolean): void {
    let tabs = next.tabs ? [...next.tabs] : this.state.tabs;
    let activeId = next.activeId ?? this.state.activeId;
    let splitTabId = next.splitTabId ?? this.state.splitTabId;
    let focusedPane = next.focusedPane ?? this.state.focusedPane;
    const booted = next.booted ?? this.state.booted;
    if (!tabs.some((tab) => tab.id === activeId)) activeId = 0;
    if (!tabs.some((tab) => tab.id === splitTabId)) splitTabId = 0;
    if (splitTabId === 0) focusedPane = "left";
    if (booted && activeId !== 0) {
      tabs = tabs.map((tab) =>
        tab.id === activeId && tab.cold ? { ...tab, cold: false } : tab,
      );
    }
    this.nextId = Math.max(
      this.nextId,
      tabs.reduce((max, tab) => Math.max(max, tab.id + 1), 1),
    );
    const activeTabByRig: Record<string, number> = {};
    for (const [rigId, id] of Object.entries(this.state.activeTabByRig)) {
      if (tabs.some((tab) => tab.id === id && tab.rigId === rigId)) {
        activeTabByRig[rigId] = id;
      }
    }
    const active = tabs.find((tab) => tab.id === activeId);
    if (active) activeTabByRig[active.rigId] = active.id;
    this.state = {
      revision: this.state.revision + 1,
      initialized,
      tabs: tabs as readonly WorkspaceTabRecord[],
      activeId,
      splitTabId,
      focusedPane,
      booted,
      activeRigIdForNewTabs:
        next.activeRigIdForNewTabs ?? this.state.activeRigIdForNewTabs,
      activeTabByRig,
    };
    for (const listener of this.listeners) listener();
  }
}

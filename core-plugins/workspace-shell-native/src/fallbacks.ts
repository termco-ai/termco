import type { PreferencesCapability } from "@termco/storage-base";
import type {
  CreateWorkspaceRigInput,
  WorkspaceEnvironmentCapability,
  WorkspaceEnvironmentSnapshot,
  WorkspaceRig,
  WorkspaceRigOverviewCapability,
  WorkspaceRigOverviewSnapshot,
  WorkspaceRigTabLayout,
  WorkspaceRigsCapability,
  WorkspaceRigsSnapshot,
  WorkspaceTabsCapability,
  WorkspaceTabsSnapshot,
  WorkspaceTabsTransition,
} from "@termco/workspace-base";

function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    snapshot: () => value,
    publish(next: T) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createFallbackWorkspaceTabs(): WorkspaceTabsCapability {
  let nextId = 1;
  const layouts = new Map<string, WorkspaceRigTabLayout>();
  const state = observable<WorkspaceTabsSnapshot>({
    revision: 0,
    initialized: false,
    tabs: [],
    activeId: 0,
    splitTabId: 0,
    focusedPane: "left",
    booted: false,
    activeRigIdForNewTabs: "default",
    activeTabByRig: {},
  });
  const transition = (patch: WorkspaceTabsTransition) => {
    const current = state.snapshot();
    state.publish({
      ...current,
      ...patch,
      revision: current.revision + 1,
      initialized: true,
    });
  };
  return {
    snapshot: state.snapshot,
    subscribe: state.subscribe,
    initialize: transition,
    allocate(count = 1) {
      return Array.from({ length: count }, () => nextId++);
    },
    transition,
    nextActiveInRig(closingId) {
      const current = state.snapshot();
      const closing = current.tabs.find((tab) => tab.id === closingId);
      if (!closing) return null;
      return (
        current.tabs.find(
          (tab) => tab.rigId === closing.rigId && tab.id !== closingId,
        )?.id ?? null
      );
    },
    selectByRigIndex(index, rigId) {
      const selected = state
        .snapshot()
        .tabs.filter((tab) => tab.rigId === rigId)[index];
      if (!selected) return null;
      transition({ activeId: selected.id });
      return selected.id;
    },
    close(tabId) {
      const current = state.snapshot();
      if (!current.tabs.some((tab) => tab.id === tabId)) return false;
      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      transition({
        tabs,
        ...(current.activeId === tabId
          ? { activeId: tabs[0]?.id ?? 0 }
          : {}),
        ...(current.splitTabId === tabId ? { splitTabId: 0 } : {}),
      });
      return true;
    },
    moveToRig(tabId, targetRigId) {
      const current = state.snapshot();
      const target = current.tabs.find((tab) => tab.id === tabId);
      if (!target || target.rigId === targetRigId) {
        return { changed: false, followTargetRig: false };
      }
      transition({
        tabs: current.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, rigId: targetRigId } : tab,
        ),
      });
      return { changed: true, followTargetRig: false };
    },
    reorderAcrossRigs(tabId, targetTabId) {
      const current = state.snapshot();
      const source = current.tabs.find((tab) => tab.id === tabId);
      const target = current.tabs.find((tab) => tab.id === targetTabId);
      if (!source || !target) {
        return { changed: false, followTargetRig: false };
      }
      transition({
        tabs: current.tabs.map((tab) =>
          tab.id === source.id ? { ...tab, rigId: target.rigId } : tab,
        ),
      });
      return { changed: true, followTargetRig: false };
    },
    reorderByGap(tabId, targetGapIndex) {
      const current = state.snapshot();
      const sourceIndex = current.tabs.findIndex((tab) => tab.id === tabId);
      if (sourceIndex < 0) return false;
      const tabs = [...current.tabs];
      const [tab] = tabs.splice(sourceIndex, 1);
      tabs.splice(Math.max(0, Math.min(targetGapIndex, tabs.length)), 0, tab);
      transition({ tabs });
      return true;
    },
    savedLayouts: () => [...layouts.values()],
    async saveLayout(layout) {
      layouts.set(layout.rigId, structuredClone(layout));
    },
    async deleteLayout(rigId) {
      layouts.delete(rigId);
    },
  };
}

export function createFallbackWorkspaceRigs(): WorkspaceRigsCapability {
  const state = observable<WorkspaceRigsSnapshot>({
    hydrated: true,
    rigs: [],
    activeId: null,
  });
  const publish = (rigs: readonly WorkspaceRig[], activeId: string | null) =>
    state.publish({ hydrated: true, rigs, activeId });
  return {
    snapshot: state.snapshot,
    subscribe: state.subscribe,
    create(input: CreateWorkspaceRigInput = {}) {
      const now = Date.now();
      const rig: WorkspaceRig = {
        id: input.id ?? `fallback-${now}`,
        name: input.name ?? "Workspace unavailable",
        root: input.root ?? null,
        workspace: input.workspace ?? { kind: "local" },
        ...(input.color === undefined ? {} : { color: input.color }),
        createdAt: now,
        updatedAt: now,
      };
      const current = state.snapshot();
      publish([...current.rigs, rig], current.activeId ?? rig.id);
      return rig;
    },
    rename(id, name) {
      const current = state.snapshot();
      publish(
        current.rigs.map((rig) =>
          rig.id === id ? { ...rig, name, updatedAt: Date.now() } : rig,
        ),
        current.activeId,
      );
    },
    setWorkspace(id, workspace, root) {
      const current = state.snapshot();
      publish(
        current.rigs.map((rig) =>
          rig.id === id
            ? {
                ...rig,
                workspace,
                ...(root === undefined ? {} : { root }),
                updatedAt: Date.now(),
              }
            : rig,
        ),
        current.activeId,
      );
    },
    setColor(id, color) {
      const current = state.snapshot();
      publish(
        current.rigs.map((rig) =>
          rig.id === id ? { ...rig, color, updatedAt: Date.now() } : rig,
        ),
        current.activeId,
      );
    },
    reorder(ids) {
      const current = state.snapshot();
      const rank = new Map(ids.map((id, index) => [id, index]));
      publish(
        [...current.rigs].sort(
          (left, right) =>
            (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
        ),
        current.activeId,
      );
    },
    remove(id) {
      const current = state.snapshot();
      const rigs = current.rigs.filter((rig) => rig.id !== id);
      publish(
        rigs,
        current.activeId === id ? (rigs[0]?.id ?? null) : current.activeId,
      );
    },
    activate(id) {
      const current = state.snapshot();
      if (current.rigs.some((rig) => rig.id === id)) {
        publish(current.rigs, id);
      }
    },
    cycle(direction) {
      const current = state.snapshot();
      if (current.rigs.length === 0) return;
      const index = Math.max(
        0,
        current.rigs.findIndex((rig) => rig.id === current.activeId),
      );
      const next =
        (index + direction + current.rigs.length) % current.rigs.length;
      publish(current.rigs, current.rigs[next].id);
    },
  };
}

export function createFallbackEnvironment(): WorkspaceEnvironmentCapability {
  const state = observable<WorkspaceEnvironmentSnapshot>({
    workspace: { kind: "local" },
    home: null,
    launchCwd: null,
    launchCwdResolved: true,
    wslDistros: [],
    wslLoading: false,
    wslError: null,
  });
  return {
    snapshot: state.snapshot,
    subscribe: state.subscribe,
    async switch(workspace) {
      state.publish({ ...state.snapshot(), workspace });
      return true;
    },
    async adopt(workspace) {
      state.publish({ ...state.snapshot(), workspace });
      return null;
    },
    async refreshWslDistros() {
      return state.snapshot().wslDistros;
    },
  };
}

export function createFallbackPreferences(): PreferencesCapability {
  const values = new Map<string, unknown>();
  const listeners = new Set<(key: string, value: unknown) => void>();
  return {
    async get<T>(key: string) {
      return values.get(key) as T | undefined;
    },
    async getMany(keys) {
      return Object.fromEntries(
        keys.flatMap((key) =>
          values.has(key) ? [[key, values.get(key)]] : [],
        ),
      );
    },
    async set(key, value) {
      values.set(key, value);
      for (const listener of [...listeners]) listener(key, value);
    },
    async delete(key) {
      const deleted = values.delete(key);
      if (deleted) {
        for (const listener of [...listeners]) listener(key, undefined);
      }
      return deleted;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createFallbackRigOverview(): WorkspaceRigOverviewCapability {
  const state = observable<WorkspaceRigOverviewSnapshot>({
    revision: 0,
    open: false,
  });
  return {
    snapshot: state.snapshot,
    subscribe: state.subscribe,
    setOpen(open) {
      const current = state.snapshot();
      state.publish({ revision: current.revision + 1, open });
    },
  };
}

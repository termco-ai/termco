import type { AiSessionsCapability } from "@termco/ai-sessions-base";
import type { BrowserTabsCapability } from "@termco/browser-base";
import type { EditorNavigationCapability } from "@termco/editor-base";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import type { UiHeaderFindTarget } from "@termco/ui-header-base";
import type {
  UiTabDescriptor,
  UiTabSearchHandle,
  UiTabsRuntime,
  UiSurfaceSearchCapability,
} from "@termco/ui-tabs-base";
import type {
  WorkspaceEnv,
  WorkspaceRig,
  WorkspaceTabRecord,
  WorkspaceTabsCapability,
} from "@termco/workspace-base";
import {
  manualOverlayOpen,
  openOverlayRects,
  subscribeOverlays,
} from "@termco/ui";

export type ReplaceSearchRegistration = (dispose: () => void) => void;

export interface TabSurfaceRuntimeDependencies {
  workspace: WorkspaceEnv;
  rigs: readonly WorkspaceRig[];
  workspaceTabs: WorkspaceTabsCapability;
  terminalSessions: TerminalSessionsCapability;
  browserTabs: BrowserTabsCapability;
  editorNavigation: EditorNavigationCapability;
  aiSessions: AiSessionsCapability;
  surfaceSearch: UiSurfaceSearchCapability;
}

export function tabDescriptor(tab: WorkspaceTabRecord): UiTabDescriptor {
  const data = tab.data ?? {};
  return {
    id: tab.id,
    rigId: tab.rigId,
    kind: tab.kind,
    title: tab.title,
    cold: Boolean(tab.cold),
    ...(typeof data.path === "string" ? { path: data.path } : {}),
    ...(typeof data.url === "string" ? { url: data.url } : {}),
    data,
  };
}

function activeRigId(tabs: WorkspaceTabsCapability): string {
  const snapshot = tabs.snapshot();
  return (
    snapshot.tabs.find((tab) => tab.id === snapshot.activeId)?.rigId ??
    snapshot.activeRigIdForNewTabs
  );
}

function patchTab(
  tabs: WorkspaceTabsCapability,
  id: number,
  patch: Readonly<Record<string, unknown>>,
  selectId?: number,
): boolean {
  const snapshot = tabs.snapshot();
  if (!snapshot.tabs.some((tab) => tab.id === id)) return false;
  const next = snapshot.tabs.map((tab): WorkspaceTabRecord => {
    if (tab.id !== id) return tab;
    const data = { ...(tab.data ?? {}), ...patch };
    if (tab.kind === "editor" && patch.dirty === true) data.preview = false;
    for (const key of ["id", "rigId", "kind", "title", "cold", "data"]) {
      delete data[key];
    }
    return {
      ...tab,
      ...(typeof patch.rigId === "string" ? { rigId: patch.rigId } : {}),
      ...(typeof patch.kind === "string" ? { kind: patch.kind } : {}),
      ...(typeof patch.title === "string" ? { title: patch.title } : {}),
      ...(typeof patch.cold === "boolean" ? { cold: patch.cold } : {}),
      data,
    };
  });
  tabs.transition({
    tabs: next,
    ...(selectId === undefined ? {} : { activeId: selectId }),
  });
  return true;
}

function replaceTab(
  tabs: WorkspaceTabsCapability,
  next: UiTabDescriptor,
): boolean {
  const snapshot = tabs.snapshot();
  if (!snapshot.tabs.some((tab) => tab.id === next.id)) return false;
  const replacement: WorkspaceTabRecord = {
    id: next.id,
    rigId: next.rigId,
    kind: next.kind,
    title: next.title,
    cold: next.cold,
    data: {
      ...(next.data ?? {}),
      ...(next.path === undefined ? {} : { path: next.path }),
      ...(next.url === undefined ? {} : { url: next.url }),
    },
  };
  tabs.transition({
    tabs: snapshot.tabs.map((tab) => (tab.id === next.id ? replacement : tab)),
  });
  return true;
}

const findTargets = new WeakMap<
  UiTabSearchHandle,
  Map<string, UiHeaderFindTarget>
>();

function findTarget(
  kind: string,
  handle: UiTabSearchHandle,
): UiHeaderFindTarget {
  const targetKind =
    kind === "terminal"
      ? "terminal"
      : kind === "editor"
        ? "editor"
        : "git-history";
  const cached = findTargets.get(handle)?.get(targetKind);
  if (cached) return cached;
  const target: UiHeaderFindTarget = {
    kind: targetKind,
    findNext: (query, options) =>
      handle.findNext?.(query, options) ?? handle.setQuery(query),
    findPrevious: (query, options) =>
      handle.findPrevious?.(query, options) ?? handle.setQuery(query),
    clear: handle.clearQuery,
    focus: handle.focus ?? (() => {}),
  };
  const byKind = findTargets.get(handle) ?? new Map();
  byKind.set(targetKind, target);
  findTargets.set(handle, byKind);
  return target;
}

function openGitCommitFileTab(
  tabs: WorkspaceTabsCapability,
  data: Readonly<Record<string, unknown>>,
): number {
  const input = data as {
    repoRoot: string;
    sha: string;
    shortSha: string;
    subject: string;
    path: string;
    originalPath: string | null;
  };
  const existing = tabs
    .snapshot()
    .tabs.find(
      (tab) =>
        tab.kind === "git-commit-file" &&
        tab.data?.repoRoot === input.repoRoot &&
        tab.data?.sha === input.sha &&
        tab.data?.path === input.path,
    );
  const basename = input.path.split(/[\\/]/).pop() ?? input.path;
  const title = `${basename} @ ${input.shortSha}`;
  if (existing) {
    patchTab(
      tabs,
      existing.id,
      {
        title,
        subject: input.subject,
        originalPath: input.originalPath,
      },
      existing.id,
    );
    return existing.id;
  }
  const id = tabs.allocate(1)[0];
  tabs.transition({
    tabs: [
      ...tabs.snapshot().tabs,
      {
        id,
        kind: "git-commit-file",
        rigId: activeRigId(tabs),
        title,
        data: input,
      },
    ],
    activeId: id,
  });
  return id;
}

export function createTabSurfaceRuntime(
  dependencies: TabSurfaceRuntimeDependencies,
  surfaceActiveId: number,
  replaceSearchRegistration: ReplaceSearchRegistration,
): UiTabsRuntime {
  const {
    workspace,
    rigs,
    workspaceTabs,
    terminalSessions,
    browserTabs,
    editorNavigation,
    aiSessions,
    surfaceSearch,
  } = dependencies;

  const openTerminalAndRun = async (command: string, cwd?: string) => {
    const opened = terminalSessions.open({ cwd });
    await terminalSessions.whenReady(opened.leafId);
    terminalSessions.write(opened.leafId, `${command}\r`);
    terminalSessions.focus(opened.leafId);
  };

  return {
    workspace,
    workspaceForRig: (rigId) =>
      rigs.find((rig) => rig.id === rigId)?.workspace ?? workspace,
    rootPathForRig: (rigId) =>
      rigs.find((rig) => rig.id === rigId)?.root ?? null,
    allTabs: () => workspaceTabs.snapshot().tabs.map(tabDescriptor),
    activeTabId: (rigId) => {
      const snapshot = workspaceTabs.snapshot();
      return rigId ? (snapshot.activeTabByRig[rigId] ?? null) : snapshot.activeId;
    },
    openTab: (kind, data) => {
      if (kind === "terminal") {
        return terminalSessions.open({
          cwd: typeof data.cwd === "string" ? data.cwd : undefined,
          blocks: data.blocks === true,
          private: data.private === true,
        }).tabId;
      }
      if (kind === "preview") {
        return browserTabs.open(typeof data.url === "string" ? data.url : "");
      }
      if (kind === "editor") {
        const path = data.path;
        if (typeof path !== "string" || !path) {
          throw new Error("Invalid editor tab request");
        }
        return typeof data.line === "number"
          ? editorNavigation.openFileAt(path, data.line)
          : editorNavigation.openFile(path, data.pin === true);
      }
      if (kind === "git-commit-file") {
        return openGitCommitFileTab(workspaceTabs, data);
      }
      throw new Error(`Unsupported source-owned tab kind: ${kind}`);
    },
    updateTab: (id, patch) => {
      patchTab(workspaceTabs, id, patch);
    },
    replaceTab: (next) => {
      replaceTab(workspaceTabs, next);
    },
    selectTab: (id) => workspaceTabs.transition({ activeId: id }),
    closeTab: (id) => {
      workspaceTabs.close(id);
    },
    runInNewTerminal: openTerminalAndRun,
    registerSearchHandle: (handle) => {
      if (!handle) {
        replaceSearchRegistration(() => {});
        return;
      }
      const kind =
        workspaceTabs.snapshot().tabs.find((tab) => tab.id === surfaceActiveId)
          ?.kind ?? "";
      replaceSearchRegistration(
        surfaceSearch.register(surfaceActiveId, findTarget(kind, handle)),
      );
    },
    subscribeOverlays,
    overlayRects: () =>
      openOverlayRects().map((rect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      })),
    hasUnpositionedOverlay: manualOverlayOpen,
    canAttachImageToAi: () => true,
    attachSelectionToAi: (text, source) =>
      aiSessions.attachSelection(text, source),
    attachImageToAi: (input) => aiSessions.attachImage(input),
  };
}

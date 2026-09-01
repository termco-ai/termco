/**
 * `useTabs` — the workspace tab state machine.
 *
 * Owns the full lifecycle of every tab: creation (terminal/editor/preview/
 * markdown/ai-diff/git-*), activation with lazy "cold" warming, closing with
 * pane-session disposal, reordering, cross-rig moves, and per-pane split/focus
 * operations. Every mutation plans against `tabsRef.current` and commits the
 * precomputed array via `commitTabs`; React 19 defers setState updaters to
 * render after the first dispatch in a batch, so return values and side effects
 * (session disposal, setActiveId) must be computed outside the dispatch. The
 * eager ref sync in `commitTabs` keeps batched multi-dispatch sequences
 * planning against fresh state.
 *
 * Pure planning logic lives in `./tabOps`; shared title helpers in
 * `./tabHelpers`; the tab data model in `./tabTypes`.
 */
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  nextLeafId,
  removeLeaf,
  type SplitDir,
  setLeafCwd as setLeafCwdInTree,
  siblingLeafOf,
  splitLeaf,
} from "../panes";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import type { WorkspaceTabRecord, WorkspaceTabsCapability } from "@termco/workspace-base";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { basename, titleFromUrl } from "./tabHelpers";
import { planRigRemoval } from "./tabOps";
import {
  DEFAULT_RIG_ID,
  type EditorTab,
  type GitCommitFileDiffTab,
  type GitHistoryTab,
  MAX_PANES_PER_TAB,
  type Tab,
  type TabPatch,
  type TerminalTab,
} from "./tabTypes";

function toWorkspaceTab(tab: Tab): WorkspaceTabRecord {
  const { id, rigId, kind, title, cold, ...data } = tab;
  return {
    id,
    rigId,
    kind,
    title,
    cold,
    data,
  };
}

function fromWorkspaceTab(tab: WorkspaceTabRecord): Tab {
  return {
    ...(tab.data ?? {}),
    id: tab.id,
    rigId: tab.rigId,
    kind: tab.kind,
    title: tab.title,
    ...(tab.cold !== undefined ? { cold: tab.cold } : {}),
  } as Tab;
}

export function useTabs(
  initial: Partial<TerminalTab> | undefined,
  workspaceTabs: WorkspaceTabsCapability,
  terminalSessions: TerminalSessionsCapability,
) {
  if (!workspaceTabs.snapshot().initialized) {
    const [tabId, leafId] = workspaceTabs.allocate(2);
    workspaceTabs.initialize({
      tabs: [
        toWorkspaceTab({
          id: tabId,
          kind: "terminal",
          rigId: DEFAULT_RIG_ID,
          cold: true,
          title: initial?.title ?? "shell",
          cwd: initial?.cwd,
          paneTree: { kind: "leaf", id: leafId, cwd: initial?.cwd },
          activeLeafId: leafId,
        }),
      ],
      activeId: tabId,
      splitTabId: 0,
      activeRigIdForNewTabs: DEFAULT_RIG_ID,
    });
  }
  const snapshot = useSyncExternalStore(
    (listener) => workspaceTabs.subscribe(listener),
    () => workspaceTabs.snapshot(),
    () => workspaceTabs.snapshot(),
  );
  const tabs = snapshot.tabs.map(fromWorkspaceTab);
  const activeId = snapshot.activeId;
  const splitTabId = snapshot.splitTabId;
  const focusedPane = snapshot.focusedPane;
  const activeRigIdRef = useRef(snapshot.activeRigIdForNewTabs);
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  const splitTabIdRef = useRef(splitTabId);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    splitTabIdRef.current = splitTabId;
  }, [splitTabId]);

  const commitTabs = useCallback(
    (next: Tab[]) => {
      tabsRef.current = next;
      workspaceTabs.transition({ tabs: next.map(toWorkspaceTab) });
      const committed = workspaceTabs.snapshot();
      activeIdRef.current = committed.activeId;
      splitTabIdRef.current = committed.splitTabId;
    },
    [workspaceTabs],
  );

  const syncProviderRefs = useCallback(() => {
    const committed = workspaceTabs.snapshot();
    tabsRef.current = committed.tabs.map(fromWorkspaceTab);
    activeIdRef.current = committed.activeId;
    splitTabIdRef.current = committed.splitTabId;
  }, [workspaceTabs]);

  const setActiveId = useCallback(
    (next: SetStateAction<number>) => {
      const current = workspaceTabs.snapshot().activeId;
      const resolved = typeof next === "function" ? next(current) : next;
      workspaceTabs.transition({
        activeId: resolved,
      });
      activeIdRef.current = workspaceTabs.snapshot().activeId;
    },
    [workspaceTabs],
  );

  const setSplitTabId = useCallback(
    (next: SetStateAction<number>) => {
      const current = workspaceTabs.snapshot().splitTabId;
      const resolved = typeof next === "function" ? next(current) : next;
      workspaceTabs.transition({
        splitTabId: resolved,
      });
      splitTabIdRef.current = workspaceTabs.snapshot().splitTabId;
    },
    [workspaceTabs],
  );

  const setFocusedPane = useCallback(
    (pane: "left" | "right") => {
      workspaceTabs.transition({ focusedPane: pane });
    },
    [workspaceTabs],
  );

  const allocId = useCallback(
    () => workspaceTabs.allocate(1)[0],
    [workspaceTabs],
  );

  const markBooted = useCallback(
    () => workspaceTabs.transition({ booted: true }),
    [workspaceTabs],
  );

  const setActiveRigForNewTabs = useCallback(
    (rigId: string) => {
      activeRigIdRef.current = rigId;
      workspaceTabs.transition({ activeRigIdForNewTabs: rigId });
    },
    [workspaceTabs],
  );

  /** Switch the tab state to a rig in one provider transition. Keeping the
   * new-tab owner and selected tab atomic prevents an intermediate external-
   * store render from restoring the previous rig's active terminal. */
  const activateRigTab = useCallback(
    (rigId: string, tabId?: number) => {
      activeRigIdRef.current = rigId;
      workspaceTabs.transition({
        activeRigIdForNewTabs: rigId,
        ...(tabId === undefined ? {} : { activeId: tabId }),
      });
      activeIdRef.current = workspaceTabs.snapshot().activeId;
    },
    [workspaceTabs],
  );

  const replaceTabs = useCallback(
    (next: Tab[], nextActiveId: number) => {
      if (next.length === 0) return;
      tabsRef.current = next;
      workspaceTabs.transition({
        tabs: next.map(toWorkspaceTab),
        activeId: nextActiveId,
      });
      activeIdRef.current = workspaceTabs.snapshot().activeId;
      splitTabIdRef.current = workspaceTabs.snapshot().splitTabId;
    },
    [workspaceTabs],
  );

  // Appends a cold terminal tab to a rig without stealing focus, so the
  // overview can populate a rig in place; it spawns when first opened.
  const newTabInRig = useCallback(
    (rigId: string, cwd?: string) => {
      const tabId = allocId();
      const leafId = allocId();
      commitTabs([
        ...tabsRef.current,
        {
          id: tabId,
          kind: "terminal",
          rigId,
          cold: true,
          title: cwd ? basename(cwd) : "shell",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
        },
      ]);
      return tabId;
    },
    [commitTabs],
  );

  // Reassigns a tab to another rig. Returns true when the moved tab was active
  // and emptied its source rig, so the caller should follow it into the target.
  const moveTabToRig = useCallback(
    (tabId: number, targetRigId: string): boolean => {
      const result = workspaceTabs.moveToRig(tabId, targetRigId);
      syncProviderRefs();
      return result.followTargetRig;
    },
    [syncProviderRefs, workspaceTabs],
  );

  // Positions a tab next to a target tab, inheriting the target's rig. Returns
  // true when the active tab crossed into the target rig and emptied its
  // source, so the caller should follow it.
  const reorderTab = useCallback(
    (tabId: number, targetTabId: number, edge: "top" | "bottom"): boolean => {
      const result = workspaceTabs.reorderAcrossRigs(tabId, targetTabId, edge);
      syncProviderRefs();
      return result.followTargetRig;
    },
    [syncProviderRefs, workspaceTabs],
  );

  const removeTabsForRig = useCallback(
    (rigId: string, fallbackRigId: string, fallbackCwd?: string) => {
      const plan = planRigRemoval(
        tabsRef.current,
        activeIdRef.current,
        rigId,
        fallbackRigId,
        fallbackCwd,
        () => allocId(),
      );
      if (!plan) return;
      commitTabs(plan.tabs);
      setActiveId(plan.activeId);
      for (const lid of plan.disposeLeafIds) terminalSessions.dispose(lid);
    },
    [commitTabs],
  );

  const newTab = useCallback(
    (cwd?: string) => {
      const tabId = allocId();
      const leafId = allocId();
      commitTabs([
        ...tabsRef.current,
        {
          id: tabId,
          kind: "terminal",
          rigId: activeRigIdRef.current,
          title: "shell",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [commitTabs],
  );

  /** Insert `tab` right after `anchorId` (or at the end if not found). */
  const insertAfter = useCallback(
    (list: Tab[], anchorId: number, tab: Tab): Tab[] => {
      const idx = list.findIndex((t) => t.id === anchorId);
      if (idx < 0) return [...list, tab];
      const next = list.slice();
      next.splice(idx + 1, 0, tab);
      return next;
    },
    [],
  );

  /** Open a fresh terminal tab immediately to the right of `anchorId`. */
  const newTabRightOf = useCallback(
    (anchorId: number) => {
      const anchor = tabsRef.current.find((t) => t.id === anchorId);
      const rigId = anchor?.rigId ?? activeRigIdRef.current;
      const cwd = anchor?.kind === "terminal" ? anchor.cwd : undefined;
      const tabId = allocId();
      const leafId = allocId();
      const tab: Tab = {
        id: tabId,
        kind: "terminal",
        rigId,
        title: "shell",
        cwd,
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      };
      commitTabs(insertAfter(tabsRef.current, anchorId, tab));
      setActiveId(tabId);
      return tabId;
    },
    [commitTabs, insertAfter],
  );

  /** Duplicate `id` into a new tab right after it. Supports terminal / editor /
   * markdown / preview; other kinds are no-ops. */
  const duplicateTab = useCallback(
    (id: number) => {
      const src = tabsRef.current.find((t) => t.id === id);
      if (!src) return;
      const newId = allocId();
      let clone: Tab | null = null;
      if (src.kind === "terminal") {
        const leafId = allocId();
        clone = {
          ...src,
          id: newId,
          cold: false,
          paneTree: { kind: "leaf", id: leafId, cwd: src.cwd },
          activeLeafId: leafId,
        };
      } else if (src.kind === "editor") {
        clone = { ...src, id: newId, cold: false, preview: false };
      } else if (src.kind === "markdown" || src.kind === "preview") {
        clone = { ...src, id: newId, cold: false };
      }
      if (!clone) return;
      commitTabs(insertAfter(tabsRef.current, id, clone));
      setActiveId(newId);
    },
    [commitTabs, insertAfter],
  );

  const newBlockTab = useCallback(
    (cwd?: string) => {
      const tabId = allocId();
      const leafId = allocId();
      commitTabs([
        ...tabsRef.current,
        {
          id: tabId,
          kind: "terminal",
          rigId: activeRigIdRef.current,
          title: "blocks",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          blocks: true,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [commitTabs],
  );

  useEffect(() => {
    if (!import.meta.env?.DEV || typeof window === "undefined") return;
    (
      window as unknown as { __termcoNewBlockTab?: (cwd?: string) => number }
    ).__termcoNewBlockTab = newBlockTab;
  }, [newBlockTab]);

  const newPrivateTab = useCallback(
    (cwd?: string) => {
      const tabId = allocId();
      const leafId = allocId();
      commitTabs([
        ...tabsRef.current,
        {
          id: tabId,
          kind: "terminal",
          rigId: activeRigIdRef.current,
          title: "private",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
          private: true,
        },
      ]);
      setActiveId(tabId);
      return tabId;
    },
    [commitTabs],
  );

  const newPreviewTab = useCallback(
    (url: string) => {
      const id = allocId();
      commitTabs([
        ...tabsRef.current,
        {
          id,
          kind: "preview",
          rigId: activeRigIdRef.current,
          title: titleFromUrl(url),
          url,
        },
      ]);
      setActiveId(id);
      return id;
    },
    [commitTabs],
  );

  const openCommitHistoryTab = useCallback(
    (input: { repoRoot: string; branch?: string | null }) => {
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) => t.kind === "git-history" && t.repoRoot === input.repoRoot,
      );
      const title = input.branch ? `History · ${input.branch}` : "Git History";
      if (existing) {
        commitTabs(
          curr.map((t) => (t.id === existing.id ? { ...t, title } : t)),
        );
        setActiveId(existing.id);
        return existing.id;
      }
      const id = allocId();
      commitTabs([
        ...curr,
        {
          id,
          kind: "git-history",
          rigId: activeRigIdRef.current,
          title,
          repoRoot: input.repoRoot,
        } satisfies GitHistoryTab,
      ]);
      setActiveId(id);
      return id;
    },
    [commitTabs],
  );

  const openCommitFileDiffTab = useCallback(
    (input: {
      repoRoot: string;
      sha: string;
      shortSha: string;
      subject: string;
      path: string;
      originalPath: string | null;
    }) => {
      const curr = tabsRef.current;
      const existing = curr.find(
        (t) =>
          t.kind === "git-commit-file" &&
          t.repoRoot === input.repoRoot &&
          t.sha === input.sha &&
          t.path === input.path,
      );
      const title = `${basename(input.path)} @ ${input.shortSha}`;
      if (existing) {
        commitTabs(
          curr.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  title,
                  subject: input.subject,
                  originalPath: input.originalPath,
                }
              : t,
          ),
        );
        setActiveId(existing.id);
        return existing.id;
      }
      const id = allocId();
      commitTabs([
        ...curr,
        {
          id,
          kind: "git-commit-file",
          rigId: activeRigIdRef.current,
          title,
          repoRoot: input.repoRoot,
          sha: input.sha,
          shortSha: input.shortSha,
          subject: input.subject,
          path: input.path,
          originalPath: input.originalPath,
        } satisfies GitCommitFileDiffTab,
      ]);
      setActiveId(id);
      return id;
    },
    [commitTabs],
  );

  const closeTab = useCallback(
    (id: number) => {
      const curr = tabsRef.current;
      const target = curr.find((t) => t.id === id);
      if (!target) return;
      const toDispose =
        target.kind === "terminal" ? leafIds(target.paneTree) : [];
      workspaceTabs.close(id);
      syncProviderRefs();
      for (const lid of toDispose) terminalSessions.dispose(lid);
    },
    [syncProviderRefs, workspaceTabs],
  );

  /** Open a tab in the second (split) pane, side-by-side with the active tab. If
   * it's the active tab, move the active tab elsewhere so one tab is never in
   * both panes. */
  const setSplit = useCallback((id: number) => {
    if (id === activeIdRef.current) {
      const other = tabsRef.current.find(
        (t) => t.id !== id && t.rigId === activeRigIdRef.current,
      );
      if (!other) return; // nothing else to show on the left — can't split
      setActiveId(other.id);
    }
    setSplitTabId(id);
  }, []);

  const closeSplit = useCallback(() => setSplitTabId(0), []);

  const updateTab = useCallback(
    (id: number, patch: TabPatch) => {
      commitTabs(
        tabsRef.current.map((x) => {
          if (x.id !== id) return x;
          if (x.kind === "terminal") {
            return {
              ...x,
              ...(patch.title !== undefined && { title: patch.title }),
              ...(patch.cwd !== undefined && { cwd: patch.cwd }),
              ...(patch.customTitle !== undefined && {
                customTitle:
                  patch.customTitle === "" ? undefined : patch.customTitle,
              }),
            };
          }
          if (x.kind === "preview") {
            return {
              ...x,
              ...(patch.title !== undefined && { title: patch.title }),
              ...(patch.url !== undefined && {
                url: patch.url,
                title: patch.title ?? titleFromUrl(patch.url),
              }),
            };
          }
          if (x.kind === "markdown") {
            return {
              ...x,
              ...(patch.title !== undefined && { title: patch.title }),
            };
          }
          // editor tab: auto-promote from preview the moment the file becomes dirty.
          const autoPin =
            patch.dirty === true && (x as EditorTab).preview
              ? { preview: false }
              : {};
          return {
            ...x,
            ...autoPin,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.dirty !== undefined && { dirty: patch.dirty }),
            ...(patch.path !== undefined && { path: patch.path }),
            ...(patch.overrideLanguage !== undefined && {
              overrideLanguage: patch.overrideLanguage,
            }),
          };
        }),
      );
    },
    [commitTabs],
  );

  const selectByIndex = useCallback(
    (idx: number, rigId?: string) => {
      if (rigId) {
        workspaceTabs.selectByRigIndex(idx, rigId);
        syncProviderRefs();
        return;
      }
      const tab = tabs[idx];
      if (tab) setActiveId(tab.id);
    },
    [setActiveId, syncProviderRefs, tabs, workspaceTabs],
  );

  /** Update a leaf's cwd; mirror to the tab's `cwd` when the leaf is active.
   * Bails out without a dispatch when nothing actually changed — shell
   * integration re-emits OSC 7 on every prompt, including empty Enters, so this
   * fires at keystroke rate. Always-dispatching there cascades a paneTree
   * re-render across every open tab. */
  const setLeafCwd = useCallback(
    (leafId: number, cwd: string) => {
      const curr = tabsRef.current;
      let changed = false;
      const next = curr.map((t) => {
        if (t.kind !== "terminal" || !hasLeaf(t.paneTree, leafId)) return t;
        const paneTree = setLeafCwdInTree(t.paneTree, leafId, cwd);
        const isActive = t.activeLeafId === leafId;
        const cwdChanged = isActive && t.cwd !== cwd;
        if (paneTree === t.paneTree && !cwdChanged) return t;
        changed = true;
        return { ...t, paneTree, ...(cwdChanged && { cwd }) };
      });
      if (changed) commitTabs(next);
    },
    [commitTabs],
  );

  const focusPane = useCallback(
    (tabId: number, leafId: number) => {
      commitTabs(
        tabsRef.current.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal") return t;
          if (!hasLeaf(t.paneTree, leafId)) return t;
          if (t.activeLeafId === leafId) return t;
          const cwd = findLeafCwd(t.paneTree, leafId);
          return {
            ...t,
            activeLeafId: leafId,
            ...(cwd !== undefined && { cwd }),
          };
        }),
      );
    },
    [commitTabs],
  );

  const focusNextPaneInTab = useCallback(
    (tabId: number, delta: 1 | -1) => {
      commitTabs(
        tabsRef.current.map((t) => {
          if (t.id !== tabId || t.kind !== "terminal") return t;
          const next = nextLeafId(t.paneTree, t.activeLeafId, delta);
          if (next === t.activeLeafId) return t;
          const cwd = findLeafCwd(t.paneTree, next);
          return {
            ...t,
            activeLeafId: next,
            ...(cwd !== undefined && { cwd }),
          };
        }),
      );
    },
    [commitTabs],
  );

  /** Split the active leaf of `tabId` along `dir`. Returns the new leaf id. */
  const splitActivePane = useCallback(
    (tabId: number, dir: SplitDir): number | null => {
      const curr = tabsRef.current;
      const t = curr.find((x) => x.id === tabId);
      if (t?.kind !== "terminal" || t.blocks) return null;
      if (leafIds(t.paneTree).length >= MAX_PANES_PER_TAB) return null;
      const splitId = allocId();
      const leafId = allocId();
      const paneTree = splitLeaf(
        t.paneTree,
        t.activeLeafId,
        splitId,
        leafId,
        dir,
        t.cwd,
      );
      commitTabs(
        curr.map((x) =>
          x === t ? { ...t, paneTree, activeLeafId: leafId } : x,
        ),
      );
      return leafId;
    },
    [commitTabs],
  );

  const closePaneByLeaf = useCallback(
    (leafId: number): void => {
      const curr = tabsRef.current;
      const tab = curr.find(
        (t): t is TerminalTab =>
          t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab) return;
      const newTree = removeLeaf(tab.paneTree, leafId);
      if (newTree === null) {
        const fallback = workspaceTabs.nextActiveInRig(tab.id);
        if (fallback === null) return;
        const wasActive = activeIdRef.current === tab.id;
        commitTabs(curr.filter((x) => x.id !== tab.id));
        if (wasActive) setActiveId(fallback);
        terminalSessions.dispose(leafId);
        return;
      }
      const remaining = leafIds(newTree);
      let newActive = tab.activeLeafId;
      if (tab.activeLeafId === leafId) {
        const sib = siblingLeafOf(tab.paneTree, leafId);
        newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      }
      commitTabs(
        curr.map((x) =>
          x.id === tab.id
            ? { ...tab, paneTree: newTree, activeLeafId: newActive }
            : x,
        ),
      );
      terminalSessions.dispose(leafId);
    },
    [commitTabs],
  );

  const closeActivePane = useCallback(
    (tabId: number): boolean => {
      const curr = tabsRef.current;
      const t = curr.find((x) => x.id === tabId);
      if (t?.kind !== "terminal") return false;
      const target = t.activeLeafId;
      const newTree = removeLeaf(t.paneTree, target);
      if (newTree === null) {
        const fallback = workspaceTabs.nextActiveInRig(tabId);
        if (fallback === null) return false;
        const wasActive = activeIdRef.current === tabId;
        commitTabs(curr.filter((x) => x.id !== tabId));
        if (wasActive) setActiveId(fallback);
        terminalSessions.dispose(target);
        return true;
      }
      const remaining = leafIds(newTree);
      const sib = siblingLeafOf(t.paneTree, target);
      const newActive = sib && remaining.includes(sib) ? sib : remaining[0];
      commitTabs(
        curr.map((x) =>
          x.id === tabId
            ? { ...t, paneTree: newTree, activeLeafId: newActive }
            : x,
        ),
      );
      terminalSessions.dispose(target);
      return false;
    },
    [commitTabs],
  );

  const resetWorkspace = useCallback(
    (cwd?: string) => {
      const toDispose = tabsRef.current.flatMap((t) =>
        t.kind === "terminal" ? leafIds(t.paneTree) : [],
      );
      const tabId = allocId();
      const leafId = allocId();
      commitTabs([
        {
          id: tabId,
          kind: "terminal",
          rigId: activeRigIdRef.current,
          title: "shell",
          cwd,
          paneTree: { kind: "leaf", id: leafId, cwd },
          activeLeafId: leafId,
        },
      ]);
      setActiveId(tabId);
      for (const lid of toDispose) terminalSessions.dispose(lid);
    },
    [commitTabs],
  );

  const reorderTabByGap = useCallback(
    (fromId: number, toGapIndex: number) => {
      workspaceTabs.reorderByGap(fromId, toGapIndex);
      syncProviderRefs();
    },
    [syncProviderRefs, workspaceTabs],
  );

  return {
    tabs,
    activeId,
    setActiveId,
    splitTabId,
    focusedPane,
    setFocusedPane,
    setSplit,
    closeSplit,
    allocId,
    replaceTabs,
    moveTabToRig,
    reorderTab,
    reorderTabByGap,
    newTabInRig,
    removeTabsForRig,
    markBooted,
    setActiveRigForNewTabs,
    activateRigTab,
    newTab,
    newTabRightOf,
    duplicateTab,
    newBlockTab,
    newPrivateTab,
    newPreviewTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    splitActivePane,
    closeActivePane,
    closePaneByLeaf,
    resetWorkspace,
  };
}

import type { WorkspaceEnv } from "@termco/workspace-base";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  /**
   * The workspace env that OWNS {@link explorerRoot} — always the active
   * rig's env. Surfaces reading `explorerRoot` (file tree, search, watch)
   * must send THIS env, never the global `currentWorkspaceEnv()` read at
   * call-time: during a rig switch the global env flips a render before the
   * root does, so a call-time read would ship the previous rig's path to the
   * new rig's backend (e.g. a local path to an ssh remote → ENOENT).
   */
  explorerEnv: NonNullable<WorkspaceEnv>;
  inheritedCwdForNewTab: () => string | undefined;
};

type Params = {
  activeTab: Tab | undefined;
  tabs: Tab[];
  /** The active rig's id — root derivation is scoped to it. */
  activeRigId: string | null;
  /** The active rig's env; returned as {@link Result.explorerEnv}. */
  env: NonNullable<WorkspaceEnv>;
  /** The active rig provider's persisted root — authoritative
   * fallback that always belongs to `env` (unlike the async `home`). */
  rigRoot: string | null;
  /** Fallback once rigs have hydrated (rig with a null root). */
  home: string | null;
  /**
   * The AI agent's current working directory (from its `bash_run` shell). When
   * set and NO terminal is the focused surface, the explorer follows it — so the
   * AI navigating "moves itself" and the folder view follows, without touching
   * the user's terminal. A focused terminal always takes precedence.
   */
  agentCwd: string | null;
  /**
   * `workspace.rigs.hydrated`. Until true, `explorerRoot` stays null: the boot
   * sequence adopts the restored rig's env + home across separate store
   * flushes, so any root derived mid-boot pairs with the wrong env — a local
   * launch cwd with the ssh env, or the adopted remote home with the local
   * fallback env. Both directions ENOENT on the wrong backend.
   */
  rigsHydrated: boolean;
};

/**
 * Derives the explorer's root directory for the ACTIVE rig, paired with the
 * env that owns it. Everything here is scoped to `activeRigId` so a root
 * never leaks across rigs:
 * - `lastTerminalCwd` is reset when the active rig changes, so a previous
 *   (e.g. local) rig's cwd can't survive into a newly-activated (e.g. ssh)
 *   rig and get read against the wrong backend.
 * - the active tab's cwd is only trusted when that tab belongs to the active
 *   rig (during a switch the active tab briefly still points at the old one).
 */
export function useWorkspaceCwd({
  activeTab,
  tabs,
  activeRigId,
  env,
  rigRoot,
  home,
  agentCwd,
  rigsHydrated,
}: Params): Result {
  const lastTerminalCwd = useRef<string | null>(null);
  const lastRigId = useRef<string | null>(activeRigId);

  // Reset the remembered cwd the moment the active rig changes (render-time,
  // before the memo below reads it), so it never carries another rig's path.
  if (lastRigId.current !== activeRigId) {
    lastRigId.current = activeRigId;
    lastTerminalCwd.current = null;
  }

  const activeTermInRig =
    activeTab?.kind === "terminal" && activeTab.rigId === activeRigId
      ? activeTab
      : undefined;

  useEffect(() => {
    if (activeTermInRig?.cwd) lastTerminalCwd.current = activeTermInRig.cwd;
  }, [activeTermInRig]);

  const explorerRoot = useMemo<string | null>(() => {
    if (!rigsHydrated) return null;
    // A focused terminal always wins (the user is navigating it directly).
    if (activeTermInRig?.cwd) return activeTermInRig.cwd;
    // Otherwise the AI's own navigation drives the view ("it moves itself").
    if (agentCwd) return agentCwd;
    if (lastTerminalCwd.current) return lastTerminalCwd.current;
    const anyTerm = tabs.find(
      (t) => t.kind === "terminal" && t.cwd && t.rigId === activeRigId,
    );
    if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
    return rigRoot ?? home;
  }, [
    activeTermInRig,
    agentCwd,
    tabs,
    activeRigId,
    rigRoot,
    home,
    rigsHydrated,
  ]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    if (activeTermInRig?.cwd) return activeTermInRig.cwd;
    // Editor tabs inherit the last terminal's cwd (or rig root/home), not
    // the file's folder — opening a new terminal from a file shouldn't
    // hijack the user's working directory context.
    return lastTerminalCwd.current ?? rigRoot ?? home ?? undefined;
  }, [activeTermInRig, rigRoot, home]);

  return { explorerRoot, explorerEnv: env, inheritedCwdForNewTab };
}

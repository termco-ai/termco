/**
 * The CORE-WORKSPACE ai-live contribution (plugin-rewrite Phase 3 step 9a) —
 * the tab-data-driven capabilities of the former useAiLiveBridge: cwd/root
 * resolution, active-file/kind queries, tab listing, and focus_view. The
 * terminal/browser/explorer capabilities live in their surface plugins; this
 * hook owns exactly what the workspace core owns (the tab model).
 *
 * Published once with ref-backed getters (cwd updates arrive from terminal
 * OSC on every shell output and would otherwise churn constantly).
 */
import type { Tab } from "../tabs";
import { resolveAgentTab } from "../tabs/lib/resolveAgentTab";
import { findLeafCwd } from "../tabs/lib/panes";
import type { AiLiveContributionCapability } from "@termco/ai-live-base";
import { useEffect, useRef } from "react";

type Params = {
  /** The RAW active (left-pane) tab id — the old bridge's `activeId`. */
  activeId: number;
  /** rigId → that rig's last-active tab id (per-rig chat binding). */
  activeTabByRig: Record<string, number>;
  tabs: Tab[];
  explorerRoot: string | null;
  launchCwd: string | null;
  home: string | null;
  setActiveId: (id: number) => void;
  /** Create a terminal tab in the active rig AND focus it. */
  newTab: (cwd?: string) => number;
  /** Temporarily re-root this workspace's explorer for the active agent. */
  setAgentCwd: (cwd: string | null) => void;
};

export function useAiLiveWorkspace(
  params: Params,
  contributions: AiLiveContributionCapability,
): void {
  const ref = useRef(params);
  ref.current = params;

  useEffect(() => {
    const resolveTerminalTab = (rigId?: string) => {
      const { tabs, activeId, activeTabByRig } = ref.current;
      return resolveAgentTab("terminal", tabs, activeId, activeTabByRig, rigId);
    };
    const findCwd = (rigId?: string) => {
      const t = resolveTerminalTab(rigId);
      if (t?.kind === "terminal") {
        return findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd ?? null;
      }
      const { explorerRoot, launchCwd, home } = ref.current;
      return explorerRoot ?? launchCwd ?? home ?? null;
    };

    return contributions.contribute({
      getCwd: findCwd,
      getWorkspaceRoot: () => {
        const { explorerRoot, launchCwd, home } = ref.current;
        return explorerRoot ?? launchCwd ?? home ?? null;
      },
      getActiveFile: () => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "editor" ? t.path : null;
      },
      getActiveKind: () => {
        const { activeId, tabs } = ref.current;
        return tabs.find((x) => x.id === activeId)?.kind ?? null;
      },
      setAgentCwd: (cwd) => ref.current.setAgentCwd(cwd),
      listTabs: (rigId) => {
        const { activeId, tabs, activeTabByRig } = ref.current;
        const activeForRig = rigId == null ? activeId : activeTabByRig[rigId];
        return tabs
          .filter((t) => rigId == null || t.rigId === rigId)
          .map((t) => ({
            id: t.id,
            kind: t.kind,
            title: t.title,
            active: t.id === activeForRig,
          }));
      },
      focusView: (target, rigId) => {
        const { tabs } = ref.current;
        const inRig = (t: Tab) => rigId == null || t.rigId === rigId;
        // Explicit tab id wins — activate any kind of tab.
        if (target.id != null) {
          const t = tabs.find((x) => x.id === target.id && inRig(x));
          if (!t) return { ok: false };
          ref.current.setActiveId(t.id);
          return { ok: true };
        }
        const kind = target.kind;
        if (!kind) return { ok: false };
        // Most-recent tab of this kind — prefer the rig's tracked active tab.
        const { activeId, activeTabByRig } = ref.current;
        const wantId = rigId == null ? activeId : activeTabByRig[rigId];
        const tracked = tabs.find((x) => x.id === wantId);
        let match: Tab | undefined =
          tracked && tracked.kind === kind && inRig(tracked)
            ? tracked
            : undefined;
        if (!match) {
          for (let i = tabs.length - 1; i >= 0; i--) {
            const t = tabs[i];
            if (t.kind === kind && inRig(t)) {
              match = t;
              break;
            }
          }
        }
        if (match) {
          ref.current.setActiveId(match.id);
          return { ok: true };
        }
        // Create-if-missing only makes sense for a terminal (editor needs a
        // path, preview a URL). newTab creates in the active rig + focuses.
        if (kind === "terminal") {
          ref.current.newTab(findCwd(rigId) ?? undefined);
          return { ok: true, created: true };
        }
        return { ok: false };
      },
    });
  }, [contributions]);
}

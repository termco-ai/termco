/**
 * Rig-scoped "which tab is the AI talking about" resolution — extracted from
 * the former useAiLiveBridge so the ai-live capability contributors
 * (core-workspace cwd/tab queries, terminal-surface terminal capabilities,
 * source preview browser capabilities) share ONE definition.
 *
 * Semantics (unchanged): the rig's tracked active tab if it has the wanted
 * kind, else the rig's most-recent tab of that kind. With no `rigId`, follow
 * the app-wide active tab, which is the current contract for unscoped callers.
 */
import type { Tab } from "./useTabs/tabTypes";

export function resolveAgentTab(
  kind: "terminal" | "preview",
  tabs: readonly Tab[],
  activeId: number,
  activeTabByRig: Record<string, number>,
  rigId?: string,
): Tab | null {
  const wantId = rigId == null ? activeId : activeTabByRig[rigId];
  const tracked = tabs.find((x) => x.id === wantId);
  if (tracked?.kind === kind && (rigId == null || tracked.rigId === rigId)) {
    return tracked;
  }
  for (let i = tabs.length - 1; i >= 0; i--) {
    const t = tabs[i];
    if (t.kind !== kind) continue;
    if (rigId != null && t.rigId !== rigId) continue;
    return t;
  }
  return null;
}

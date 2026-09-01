/**
 * Pure, side-effect-free planning functions over a `Tab[]` list for bulk
 * closing and rig removal. Selection and reorder transitions belong to the
 * selected workspace-tabs provider so consumers cannot diverge.
 */
import { leafIds } from "../panes";
import { basename } from "./tabHelpers";
import type { Tab, TerminalTab } from "./tabTypes";

/** Which tabs a bulk "close" acts on, relative to the right-clicked tab. */
export type BulkCloseMode = "others" | "right" | "left" | "all";

/**
 * Plans a Chrome-style bulk close relative to `anchorId`: the ids to close,
 * scoped to the anchor's rig and in strip order. For "others"/"right"/"left"
 * the anchor is kept; "all" closes the whole rig (including the anchor),
 * leaving it empty. Returns `[]` when there is nothing to close.
 */
export function planBulkClose(
  tabs: Tab[],
  anchorId: number,
  mode: BulkCloseMode,
): number[] {
  const anchor = tabs.find((t) => t.id === anchorId);
  if (!anchor) return [];
  const strip = tabs.filter((t) => t.rigId === anchor.rigId);
  const idx = strip.findIndex((t) => t.id === anchorId);
  if (idx < 0) return [];
  const victims =
    mode === "all"
      ? strip
      : mode === "others"
        ? strip.filter((t) => t.id !== anchorId)
        : mode === "right"
          ? strip.slice(idx + 1)
          : strip.slice(0, idx);
  return victims.map((t) => t.id);
}

/** Builds a cold (unmounted, placeholder) terminal tab for the given rig. */
function coldTerminalTab(
  tabId: number,
  leafId: number,
  rigId: string,
  cwd?: string,
): TerminalTab {
  return {
    id: tabId,
    kind: "terminal",
    rigId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd,
    paneTree: { kind: "leaf", id: leafId, cwd },
    activeLeafId: leafId,
  };
}

/**
 * Plans the removal of a deleted rig's tabs while keeping the invariant that
 * the now-active `fallbackRigId` always has at least one tab (a cold one is
 * spawned when it would be left empty). Returns null when nothing to remove.
 */
export function planRigRemoval(
  tabs: Tab[],
  currentActiveId: number,
  rigId: string,
  fallbackRigId: string,
  fallbackCwd: string | undefined,
  allocId: () => number,
): { tabs: Tab[]; disposeLeafIds: number[]; activeId: number } | null {
  const removed = tabs.filter((t) => t.rigId === rigId);
  if (removed.length === 0) return null;
  const disposeLeafIds = removed
    .filter((t) => t.kind === "terminal")
    .flatMap((t) => leafIds((t as TerminalTab).paneTree));
  let next = tabs.filter((t) => t.rigId !== rigId);
  let activeId = currentActiveId;
  if (!next.some((t) => t.rigId === fallbackRigId)) {
    const tabId = allocId();
    next = [
      ...next,
      coldTerminalTab(tabId, allocId(), fallbackRigId, fallbackCwd),
    ];
    activeId = tabId;
  } else if (!next.some((t) => t.id === currentActiveId)) {
    const inFallback = next.filter((t) => t.rigId === fallbackRigId);
    activeId = inFallback[inFallback.length - 1].id;
  }
  return { tabs: next, disposeLeafIds, activeId };
}

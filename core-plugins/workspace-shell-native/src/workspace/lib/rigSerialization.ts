import {
  type EditorTab,
  isPluginTab,
  type MarkdownTab,
  type PluginTab,
  type PreviewTab,
  type Tab,
  type TerminalTab,
} from "../tabs";
import { isLeaf, type PaneNode, type SplitDir } from "../tabs/lib/panes";
import type { WorkspaceSavedTab } from "@termco/workspace-base";

type SerializedNode =
  | { kind: "leaf"; cwd?: string; active?: boolean }
  | { kind: "split"; dir: SplitDir; children: SerializedNode[] };

export type SerializedTab =
  | {
      kind: "terminal";
      tree: SerializedNode;
      blocks?: boolean;
      customTitle?: string;
    }
  | { kind: "editor"; path: string }
  | { kind: "preview"; url: string }
  | { kind: "markdown"; path: string }
  | {
      kind: `plugin:${string}`;
      title: string;
      data?: Record<string, unknown>;
    };

function serializeNode(node: PaneNode, activeLeafId: number): SerializedNode {
  if (isLeaf(node)) {
    return {
      kind: "leaf",
      ...(node.cwd !== undefined ? { cwd: node.cwd } : {}),
      ...(node.id === activeLeafId ? { active: true } : {}),
    };
  }
  return {
    kind: "split",
    dir: node.dir,
    children: node.children.map((child) =>
      serializeNode(child, activeLeafId),
    ),
  };
}

export function isSerializableTab(tab: Tab): boolean {
  if (isPluginTab(tab)) return true;
  switch (tab.kind) {
    case "terminal":
      return !tab.private;
    case "editor":
    case "preview":
    case "markdown":
      return true;
    default:
      return false;
  }
}

function serializeTab(tab: Tab): SerializedTab | null {
  if (!isSerializableTab(tab)) return null;
  if (isPluginTab(tab)) {
    return {
      kind: tab.kind,
      title: tab.title,
      ...(tab.data !== undefined ? { data: tab.data } : {}),
    };
  }
  switch (tab.kind) {
    case "terminal":
      return {
        kind: "terminal",
        tree: serializeNode(tab.paneTree, tab.activeLeafId),
        ...(tab.blocks ? { blocks: true } : {}),
        ...(tab.customTitle !== undefined
          ? { customTitle: tab.customTitle }
          : {}),
      };
    case "editor":
      return { kind: "editor", path: tab.path };
    case "preview":
      return { kind: "preview", url: tab.url };
    case "markdown":
      return { kind: "markdown", path: tab.path };
    default:
      return null;
  }
}

export function serializeTabs(tabs: readonly Tab[]): WorkspaceSavedTab[] {
  const serialized: WorkspaceSavedTab[] = [];
  for (const tab of tabs) {
    const value = serializeTab(tab);
    if (value) serialized.push(value);
  }
  return serialized;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "preview";
  }
}

function collectLeaves(node: PaneNode): Array<{ id: number; cwd?: string }> {
  if (isLeaf(node)) return [{ id: node.id, cwd: node.cwd }];
  return node.children.flatMap(collectLeaves);
}

function hydrateNode(
  node: SerializedNode,
  allocate: () => number,
  active: { id: number | null },
): PaneNode {
  if (node.kind === "leaf") {
    const id = allocate();
    if (node.active && active.id === null) active.id = id;
    return {
      kind: "leaf",
      id,
      ...(node.cwd !== undefined ? { cwd: node.cwd } : {}),
    };
  }
  const children = node.children.map((child) =>
    hydrateNode(child, allocate, active),
  );
  if (children.length === 0) return { kind: "leaf", id: allocate() };
  if (children.length === 1) return children[0];
  return { kind: "split", id: allocate(), dir: node.dir, children };
}

function hydrateTab(
  saved: SerializedTab,
  rigId: string,
  allocate: () => number,
): Tab | null {
  switch (saved.kind) {
    case "terminal": {
      const active = { id: null as number | null };
      const paneTree = hydrateNode(saved.tree, allocate, active);
      const leaves = collectLeaves(paneTree);
      const activeLeafId = active.id ?? leaves[0]?.id ?? allocate();
      const cwd =
        leaves.find((leaf) => leaf.id === activeLeafId)?.cwd ?? leaves[0]?.cwd;
      return {
        id: allocate(),
        kind: "terminal",
        rigId,
        cold: true,
        title:
          saved.customTitle ??
          (cwd ? basename(cwd) : saved.blocks ? "blocks" : "shell"),
        cwd,
        paneTree,
        activeLeafId,
        ...(saved.blocks ? { blocks: true } : {}),
        ...(saved.customTitle !== undefined
          ? { customTitle: saved.customTitle }
          : {}),
      } satisfies TerminalTab;
    }
    case "editor":
      return {
        id: allocate(),
        kind: "editor",
        rigId,
        cold: true,
        title: basename(saved.path),
        path: saved.path,
        dirty: false,
        preview: false,
      } satisfies EditorTab;
    case "preview":
      return {
        id: allocate(),
        kind: "preview",
        rigId,
        cold: true,
        title: titleFromUrl(saved.url),
        url: saved.url,
      } satisfies PreviewTab;
    case "markdown":
      return {
        id: allocate(),
        kind: "markdown",
        rigId,
        cold: true,
        title: basename(saved.path),
        path: saved.path,
      } satisfies MarkdownTab;
    default:
      if (typeof saved.kind === "string" && saved.kind.startsWith("plugin:")) {
        return {
          id: allocate(),
          kind: saved.kind as `plugin:${string}`,
          rigId,
          cold: true,
          title: typeof saved.title === "string" ? saved.title : saved.kind,
          ...(saved.data !== undefined ? { data: saved.data } : {}),
        } satisfies PluginTab;
      }
      return null;
  }
}

export function hydrateTabs(
  saved: readonly WorkspaceSavedTab[],
  rigId: string,
  allocate: () => number,
): Tab[] {
  if (!Array.isArray(saved)) return [];
  const tabs: Tab[] = [];
  for (const value of saved) {
    try {
      const tab = hydrateTab(value as SerializedTab, rigId, allocate);
      if (tab) tabs.push(tab);
    } catch {
      // A corrupt saved tab must not prevent the remaining rig from loading.
    }
  }
  return tabs;
}

export function freshTerminalTab(
  rigId: string,
  cwd: string | null,
  allocate: () => number,
): TerminalTab {
  const leafId = allocate();
  return {
    id: allocate(),
    kind: "terminal",
    rigId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd: cwd ?? undefined,
    paneTree: { kind: "leaf", id: leafId, ...(cwd ? { cwd } : {}) },
    activeLeafId: leafId,
  };
}

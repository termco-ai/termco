/**
 * Pane-tree data model.
 *
 * A tab's terminal layout is a binary-ish tree of `leaf` (a single terminal)
 * and `split` (a row/column of children) nodes. These are the shape types plus
 * the `isLeaf` narrowing guard; the tree transforms live in `./ops`.
 */

export type PaneId = number;

export type SplitDir = "row" | "col";

export type PaneNode =
  | { kind: "leaf"; id: PaneId; cwd?: string }
  | {
      kind: "split";
      id: PaneId;
      dir: SplitDir;
      children: PaneNode[];
    };

/** Type guard narrowing a node to the `leaf` variant. */
export function isLeaf(n: PaneNode): n is Extract<PaneNode, { kind: "leaf" }> {
  return n.kind === "leaf";
}


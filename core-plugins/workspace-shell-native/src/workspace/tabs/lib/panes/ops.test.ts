import { describe, expect, it } from "vitest";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  nextLeafId,
  removeLeaf,
  setLeafCwd,
  siblingLeafOf,
  splitLeaf,
} from "./ops";
import { isLeaf, type PaneNode } from "./types";

function leaf(id: number, cwd?: string): PaneNode {
  return { kind: "leaf", id, cwd };
}

function row(id: number, ...children: PaneNode[]): PaneNode {
  return { kind: "split", id, dir: "row", children };
}

function col(id: number, ...children: PaneNode[]): PaneNode {
  return { kind: "split", id, dir: "col", children };
}

describe("isLeaf", () => {
  it("narrows leaf nodes and rejects splits", () => {
    expect(isLeaf(leaf(1))).toBe(true);
    expect(isLeaf(row(9, leaf(1)))).toBe(false);
  });
});

describe("leafIds", () => {
  it("returns the single id of a leaf", () => {
    expect(leafIds(leaf(7))).toEqual([7]);
  });

  it("flattens nested splits in document order", () => {
    const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)), leaf(4));
    expect(leafIds(tree)).toEqual([1, 2, 3, 4]);
  });
});

describe("findLeafCwd", () => {
  const tree = row(100, leaf(1, "/a"), col(101, leaf(2), leaf(3, "/c")));

  it("finds the cwd of a nested leaf", () => {
    expect(findLeafCwd(tree, 3)).toBe("/c");
  });

  it("returns undefined for a leaf without cwd", () => {
    expect(findLeafCwd(tree, 2)).toBeUndefined();
  });

  it("returns undefined for a missing id", () => {
    expect(findLeafCwd(tree, 42)).toBeUndefined();
  });
});

describe("setLeafCwd", () => {
  it("returns a new tree with the updated leaf", () => {
    const tree = row(100, leaf(1, "/a"), leaf(2, "/b"));
    const next = setLeafCwd(tree, 2, "/z");
    expect(next).not.toBe(tree);
    expect(findLeafCwd(next, 2)).toBe("/z");
    expect(findLeafCwd(next, 1)).toBe("/a");
  });

  it("returns the same reference when cwd is unchanged", () => {
    const tree = row(100, leaf(1, "/a"), leaf(2, "/b"));
    expect(setLeafCwd(tree, 2, "/b")).toBe(tree);
  });

  it("returns the same reference when the id is absent", () => {
    const tree = row(100, leaf(1, "/a"), leaf(2, "/b"));
    expect(setLeafCwd(tree, 42, "/z")).toBe(tree);
  });

  it("shares untouched sibling subtrees", () => {
    const untouched = col(101, leaf(2), leaf(3));
    const tree = row(100, leaf(1, "/a"), untouched);
    const next = setLeafCwd(tree, 1, "/new");
    expect(isLeaf(next)).toBe(false);
    if (next.kind === "split") {
      expect(next.children[1]).toBe(untouched);
    }
  });

  it("updates a lone root leaf", () => {
    expect(setLeafCwd(leaf(1), 1, "/x")).toEqual(leaf(1, "/x"));
  });
});

describe("splitLeaf", () => {
  it("wraps a root leaf into a new split", () => {
    const next = splitLeaf(leaf(1, "/a"), 1, 100, 2, "row", "/b");
    expect(next).toEqual(row(100, leaf(1, "/a"), leaf(2, "/b")));
  });

  it("appends as a sibling when the enclosing split runs the same way", () => {
    const tree = row(100, leaf(1), leaf(2));
    const next = splitLeaf(tree, 1, 999, 3, "row");
    expect(next).toEqual(row(100, leaf(1), leaf(3), leaf(2)));
    expect(leafIds(next)).toEqual([1, 3, 2]);
  });

  it("nests a new split when directions differ", () => {
    const tree = row(100, leaf(1), leaf(2));
    const next = splitLeaf(tree, 1, 101, 3, "col", "/c");
    expect(next).toEqual(row(100, col(101, leaf(1), leaf(3, "/c")), leaf(2)));
  });

  it("splits a leaf nested inside an opposite-direction split", () => {
    const tree = col(100, leaf(1), row(101, leaf(2), leaf(3)));
    const next = splitLeaf(tree, 2, 999, 4, "row");
    expect(leafIds(next)).toEqual([1, 2, 4, 3]);
  });

  it("returns the tree unchanged when the target is missing", () => {
    const tree = row(100, leaf(1), leaf(2));
    expect(leafIds(splitLeaf(tree, 42, 101, 3, "col"))).toEqual([1, 2]);
  });

  it("does not treat a nested split node as a same-direction sibling target", () => {
    // target 2 sits inside a nested col; the outer row must not append there.
    const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)));
    const next = splitLeaf(tree, 2, 102, 4, "row");
    expect(next).toEqual(
      row(100, leaf(1), col(101, row(102, leaf(2), leaf(4)), leaf(3))),
    );
  });
});

describe("removeLeaf", () => {
  it("returns null when removing the root leaf", () => {
    expect(removeLeaf(leaf(1), 1)).toBeNull();
  });

  it("returns the leaf unchanged when the id differs", () => {
    const l = leaf(1);
    expect(removeLeaf(l, 2)).toBe(l);
  });

  it("collapses a two-child split into the survivor", () => {
    const tree = row(100, leaf(1), leaf(2));
    expect(removeLeaf(tree, 1)).toEqual(leaf(2));
  });

  it("keeps a split with remaining children", () => {
    const tree = row(100, leaf(1), leaf(2), leaf(3));
    expect(removeLeaf(tree, 2)).toEqual(row(100, leaf(1), leaf(3)));
  });

  it("collapses cascading single-child splits", () => {
    const tree = row(100, col(101, leaf(1), leaf(2)));
    expect(removeLeaf(tree, 1)).toEqual(leaf(2));
  });

  it("removes a nested leaf and flattens the emptied split", () => {
    const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)));
    expect(removeLeaf(tree, 3)).toEqual(row(100, leaf(1), leaf(2)));
  });
});

describe("nextLeafId", () => {
  const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)));

  it("cycles forward", () => {
    expect(nextLeafId(tree, 1, 1)).toBe(2);
    expect(nextLeafId(tree, 3, 1)).toBe(1);
  });

  it("cycles backward", () => {
    expect(nextLeafId(tree, 1, -1)).toBe(3);
    expect(nextLeafId(tree, 2, -1)).toBe(1);
  });

  it("falls back to the first leaf when the current id is unknown", () => {
    expect(nextLeafId(tree, 42, 1)).toBe(1);
  });

  it("returns the current id on a single-leaf tree cycle", () => {
    expect(nextLeafId(leaf(9), 9, 1)).toBe(9);
  });
});

describe("siblingLeafOf", () => {
  it("prefers the next sibling", () => {
    const tree = row(100, leaf(1), leaf(2), leaf(3));
    expect(siblingLeafOf(tree, 2)).toBe(3);
  });

  it("falls back to the previous sibling for the last child", () => {
    const tree = row(100, leaf(1), leaf(2));
    expect(siblingLeafOf(tree, 2)).toBe(1);
  });

  it("descends into a split sibling to its first leaf", () => {
    const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)));
    expect(siblingLeafOf(tree, 1)).toBe(2);
  });

  it("recurses into nested splits to find the enclosing split", () => {
    const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)));
    expect(siblingLeafOf(tree, 2)).toBe(3);
  });

  it("returns null on a root leaf", () => {
    expect(siblingLeafOf(leaf(1), 1)).toBeNull();
  });

  it("returns null for a sole child with no siblings", () => {
    const tree = row(100, leaf(1));
    expect(siblingLeafOf(tree, 1)).toBeNull();
  });

  it("returns null when the leaf is not in the tree", () => {
    const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)));
    expect(siblingLeafOf(tree, 42)).toBeNull();
  });
});

describe("hasLeaf", () => {
  const tree = row(100, leaf(1), col(101, leaf(2), leaf(3)));

  it("finds present leaves", () => {
    expect(hasLeaf(tree, 3)).toBe(true);
  });

  it("rejects absent ids including split ids", () => {
    expect(hasLeaf(tree, 42)).toBe(false);
    expect(hasLeaf(tree, 101)).toBe(false);
  });
});


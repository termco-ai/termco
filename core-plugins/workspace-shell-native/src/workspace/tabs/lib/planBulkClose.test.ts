import { describe, expect, it } from "vitest";
import { planBulkClose } from "./useTabs/tabOps";
import type { Tab } from "./useTabs/tabTypes";

/** Minimal editor tab in a given rig. */
function tab(id: number, rigId = "s1"): Tab {
  return {
    id,
    kind: "editor",
    rigId,
    title: `t${id}`,
    path: `/f${id}`,
    dirty: false,
    preview: false,
  };
}

// Strip: [1, 2, 3, 4, 5] in rig s1; anchor = 3.
const tabs: Tab[] = [tab(1), tab(2), tab(3), tab(4), tab(5)];

describe("planBulkClose", () => {
  it("'right' closes tabs after the anchor, in order", () => {
    expect(planBulkClose(tabs, 3, "right")).toEqual([4, 5]);
  });

  it("'left' closes tabs before the anchor, in order", () => {
    expect(planBulkClose(tabs, 3, "left")).toEqual([1, 2]);
  });

  it("'others' closes every tab except the anchor", () => {
    expect(planBulkClose(tabs, 3, "others")).toEqual([1, 2, 4, 5]);
  });

  it("keeps the anchor in every mode (never empties the rig)", () => {
    for (const mode of ["others", "right", "left"] as const) {
      expect(planBulkClose(tabs, 3, mode)).not.toContain(3);
    }
  });

  it("returns [] when there is nothing on the requested side", () => {
    expect(planBulkClose(tabs, 5, "right")).toEqual([]);
    expect(planBulkClose(tabs, 1, "left")).toEqual([]);
  });

  it("is scoped to the anchor's rig", () => {
    const mixed: Tab[] = [
      tab(1, "s1"),
      tab(2, "s2"),
      tab(3, "s1"),
      tab(4, "s2"),
    ];
    // Anchor 1 (s1); the only other s1 tab is 3 → others = [3], s2 tabs ignored.
    expect(planBulkClose(mixed, 1, "others")).toEqual([3]);
    expect(planBulkClose(mixed, 1, "right")).toEqual([3]);
  });

  it("'all' closes the whole rig including the anchor", () => {
    expect(planBulkClose(tabs, 3, "all")).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns [] for an unknown anchor", () => {
    expect(planBulkClose(tabs, 99, "others")).toEqual([]);
  });
});


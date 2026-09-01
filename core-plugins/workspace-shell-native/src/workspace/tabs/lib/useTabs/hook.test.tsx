// @vitest-environment jsdom
import type { PreferencesCapability } from "@termco/storage-base";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import type { WorkspaceTabRecord, WorkspaceTabsCapability } from "@termco/workspace-base";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leafIds } from "../panes";
import { useTabs } from "./hook";
import type { EditorTab, Tab, TerminalTab } from "./tabTypes";
import { WorkspaceTabsStore } from "./workspaceTabsTestAdapter";

const disposeSession = vi.fn();
const terminalSessions = {
  dispose: disposeSession,
} as unknown as TerminalSessionsCapability;
let workspaceTabs: WorkspaceTabsCapability;

function mount(initial?: Partial<TerminalTab>) {
  return renderHook(() => useTabs(initial, workspaceTabs, terminalSessions));
}

function mountRecords(records: WorkspaceTabRecord[]) {
  const store = new WorkspaceTabsStore(preferences);
  store.initialize({
    tabs: records,
    activeId: records[0]?.id ?? 0,
    activeRigIdForNewTabs: records[0]?.rigId ?? "default",
  });
  workspaceTabs = store;
  return mount();
}

function terminalAt(tabs: Tab[], id: number): TerminalTab {
  const t = tabs.find((x) => x.id === id);
  if (t?.kind !== "terminal") throw new Error(`tab ${id} is not a terminal`);
  return t;
}

const preferences: PreferencesCapability = {
  get: vi.fn(async () => undefined) as PreferencesCapability["get"],
  getMany: vi.fn(async () => ({})),
  set: vi.fn(async () => {}),
  delete: vi.fn(async () => false),
  subscribe: () => () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  workspaceTabs = new WorkspaceTabsStore(preferences);
});

afterEach(() => {
  cleanup();
});

describe("boot and warming", () => {
  it("starts with a single cold terminal tab", () => {
    const { result } = mount({ cwd: "/home/u/proj", title: "start" });
    expect(result.current.tabs).toHaveLength(1);
    const t = terminalAt(result.current.tabs, 1);
    expect(t.cold).toBe(true);
    expect(t.title).toBe("start");
    expect(t.cwd).toBe("/home/u/proj");
    expect(t.paneTree).toEqual({ kind: "leaf", id: 2, cwd: "/home/u/proj" });
    expect(result.current.activeId).toBe(1);
  });

  it("keeps tabs cold until markBooted, then warms the active tab", () => {
    const { result } = mount();
    expect(terminalAt(result.current.tabs, 1).cold).toBe(true);
    act(() => result.current.markBooted());
    expect(terminalAt(result.current.tabs, 1).cold).toBeFalsy();
  });

  it("warms a cold tab when it becomes active", () => {
    const { result } = mount();
    act(() => result.current.markBooted());
    let id = 0;
    act(() => {
      id = result.current.newTabInRig("default", "/w");
    });
    expect(terminalAt(result.current.tabs, id).cold).toBe(true);
    act(() => result.current.setActiveId(id));
    expect(terminalAt(result.current.tabs, id).cold).toBeFalsy();
  });
});

describe("terminal tab creation", () => {
  it("changes the rig owner and selected tab in one transition", () => {
    const { result } = mount();
    let rigTab = 0;
    act(() => {
      rigTab = result.current.newTabInRig("s2", "/remote");
      result.current.activateRigTab("s2", rigTab);
    });

    expect(result.current.activeId).toBe(rigTab);
    let next = 0;
    act(() => {
      next = result.current.newTab("/next");
    });
    expect(terminalAt(result.current.tabs, next).rigId).toBe("s2");
  });

  it("newTab appends an active shell in the current rig", () => {
    const { result } = mount();
    act(() => result.current.setActiveRigForNewTabs("s2"));
    let id = 0;
    act(() => {
      id = result.current.newTab("/cwd");
    });
    const t = terminalAt(result.current.tabs, id);
    expect(t.rigId).toBe("s2");
    expect(t.title).toBe("shell");
    expect(t.cwd).toBe("/cwd");
    expect(result.current.activeId).toBe(id);
  });

  it("newBlockTab creates a blocks terminal and exposes the dev hook", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newBlockTab();
    });
    const t = terminalAt(result.current.tabs, id);
    expect(t.blocks).toBe(true);
    expect(t.title).toBe("blocks");
    const w = window as unknown as { __termcoNewBlockTab?: unknown };
    expect(typeof w.__termcoNewBlockTab).toBe("function");
  });

  it("newPrivateTab creates a private terminal", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newPrivateTab("/p");
    });
    const t = terminalAt(result.current.tabs, id);
    expect(t.private).toBe(true);
    expect(t.title).toBe("private");
  });

  it("newTabInRig appends a cold tab without stealing focus", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTabInRig("other", "/x/y");
    });
    const t = terminalAt(result.current.tabs, id);
    expect(t.rigId).toBe("other");
    expect(t.cold).toBe(true);
    expect(t.title).toBe("y");
    expect(result.current.activeId).toBe(1);
  });
});

describe("updateTab", () => {
  it("patches terminal title, cwd and custom title", () => {
    const { result } = mount();
    act(() =>
      result.current.updateTab(1, {
        title: "t2",
        cwd: "/new",
        customTitle: "Named",
      }),
    );
    let t = terminalAt(result.current.tabs, 1);
    expect(t.title).toBe("t2");
    expect(t.cwd).toBe("/new");
    expect(t.customTitle).toBe("Named");
    act(() => result.current.updateTab(1, { customTitle: "" }));
    t = terminalAt(result.current.tabs, 1);
    expect(t.customTitle).toBeUndefined();
  });

  it("derives a preview tab title from a url patch", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newPreviewTab("http://localhost:3000");
    });
    act(() =>
      result.current.updateTab(id, { url: "http://localhost:5173/app" }),
    );
    const t = result.current.tabs.find((x) => x.id === id);
    expect(t?.kind).toBe("preview");
    if (t?.kind === "preview") {
      expect(t.url).toBe("http://localhost:5173/app");
      expect(t.title).toBe("localhost:5173");
    }
  });

  it("auto-pins an editor preview tab the moment it becomes dirty", () => {
    const { result } = mountRecords([
      {
        id: 1,
        rigId: "default",
        kind: "editor",
        title: "foo.ts",
        data: { path: "/a/foo.ts", dirty: false, preview: true },
      },
    ]);
    act(() => result.current.updateTab(1, { dirty: true }));
    const t = result.current.tabs[0] as EditorTab;
    expect(t.dirty).toBe(true);
    expect(t.preview).toBe(false);
  });

  it("patches editor path and override language", () => {
    const { result } = mountRecords([
      {
        id: 1,
        rigId: "default",
        kind: "editor",
        title: "foo.ts",
        data: { path: "/a/foo.ts", dirty: false, preview: false },
      },
    ]);
    act(() =>
      result.current.updateTab(1, {
        path: "/a/bar.ts",
        overrideLanguage: "rs",
      }),
    );
    const t = result.current.tabs[0] as EditorTab;
    expect(t.path).toBe("/a/bar.ts");
    expect(t.overrideLanguage).toBe("rs");
  });

  it("patches a markdown tab title", () => {
    const { result } = mountRecords([
      {
        id: 1,
        rigId: "default",
        kind: "markdown",
        title: "README.md",
        data: { path: "/a/README.md" },
      },
    ]);
    act(() => result.current.updateTab(1, { title: "Docs" }));
    const t = result.current.tabs[0];
    expect(t?.title).toBe("Docs");
  });
});

describe("closeTab", () => {
  it("closes the last tab of a rig, leaving it empty", () => {
    const { result } = mount();
    const leaves = leafIds(terminalAt(result.current.tabs, 1).paneTree);
    act(() => result.current.closeTab(1));
    expect(result.current.tabs).toHaveLength(0);
    expect(result.current.activeId).toBe(0);
    for (const lid of leaves) expect(disposeSession).toHaveBeenCalledWith(lid);
  });

  it("closes a terminal, disposes its leaves and falls back", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
    });
    const leaves = leafIds(terminalAt(result.current.tabs, id).paneTree);
    act(() => result.current.closeTab(id));
    expect(result.current.tabs.map((t) => t.id)).toEqual([1]);
    expect(result.current.activeId).toBe(1);
    for (const lid of leaves) expect(disposeSession).toHaveBeenCalledWith(lid);
  });

  it("keeps the active id when closing an inactive tab", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
    });
    act(() => result.current.setActiveId(1));
    act(() => result.current.closeTab(id));
    expect(result.current.activeId).toBe(1);
  });
});

describe("preview tabs", () => {
  it("newPreviewTab titles from the url host", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newPreviewTab("http://localhost:5173");
    });
    const t = result.current.tabs.find((x) => x.id === id);
    expect(t?.kind).toBe("preview");
    expect(t?.title).toBe("localhost:5173");
    expect(result.current.activeId).toBe(id);
  });
});

describe("git tabs", () => {
  it("openCommitHistoryTab creates one tab per repo and retitles it", () => {
    const { result } = mount();
    let a = 0;
    let b = 0;
    act(() => {
      a = result.current.openCommitHistoryTab({ repoRoot: "/repo" });
    });
    act(() => {
      b = result.current.openCommitHistoryTab({
        repoRoot: "/repo",
        branch: "main",
      });
    });
    expect(b).toBe(a);
    const t = result.current.tabs.find((x) => x.id === a);
    expect(t?.title).toBe("History · main");
  });

  it("openCommitFileDiffTab creates then updates by repo+sha+path", () => {
    const { result } = mount();
    const base = {
      repoRoot: "/repo",
      sha: "abcdef1234",
      shortSha: "abcdef1",
      path: "src/x.ts",
      originalPath: null,
    };
    let a = 0;
    let b = 0;
    act(() => {
      a = result.current.openCommitFileDiffTab({ ...base, subject: "one" });
    });
    act(() => {
      b = result.current.openCommitFileDiffTab({
        ...base,
        subject: "two",
        originalPath: "src/old.ts",
      });
    });
    expect(b).toBe(a);
    const t = result.current.tabs.find((x) => x.id === a);
    expect(t?.kind).toBe("git-commit-file");
    if (t?.kind === "git-commit-file") {
      expect(t.title).toBe("x.ts @ abcdef1");
      expect(t.subject).toBe("two");
      expect(t.originalPath).toBe("src/old.ts");
    }
  });
});

describe("selection", () => {
  it("selectByIndex activates by flat index", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
    });
    act(() => result.current.selectByIndex(0));
    expect(result.current.activeId).toBe(1);
    act(() => result.current.selectByIndex(1));
    expect(result.current.activeId).toBe(id);
  });

  it("selectByIndex scopes to a rig when given", () => {
    const { result } = mount();
    let other = 0;
    act(() => {
      other = result.current.newTabInRig("s2");
    });
    act(() => result.current.selectByIndex(0, "s2"));
    expect(result.current.activeId).toBe(other);
    act(() => result.current.selectByIndex(5, "s2"));
    expect(result.current.activeId).toBe(other);
  });
});

describe("panes", () => {
  it("splitActivePane adds a leaf and focuses it", () => {
    const { result } = mount({ cwd: "/w" });
    let leaf: number | null = null;
    act(() => {
      leaf = result.current.splitActivePane(1, "row");
    });
    const t = terminalAt(result.current.tabs, 1);
    expect(leaf).not.toBeNull();
    expect(t.activeLeafId).toBe(leaf);
    expect(leafIds(t.paneTree)).toHaveLength(2);
  });

  it("splitActivePane stops at the pane cap", () => {
    const { result } = mount();
    act(() => {
      result.current.splitActivePane(1, "row");
      result.current.splitActivePane(1, "row");
      result.current.splitActivePane(1, "row");
    });
    expect(leafIds(terminalAt(result.current.tabs, 1).paneTree)).toHaveLength(
      4,
    );
    let leaf: number | null = null;
    act(() => {
      leaf = result.current.splitActivePane(1, "col");
    });
    expect(leaf).toBeNull();
    expect(leafIds(terminalAt(result.current.tabs, 1).paneTree)).toHaveLength(
      4,
    );
  });

  it("splitActivePane refuses blocks tabs", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newBlockTab();
    });
    let leaf: number | null = null;
    act(() => {
      leaf = result.current.splitActivePane(id, "row");
    });
    expect(leaf).toBeNull();
  });

  it("setLeafCwd updates the leaf and mirrors to the tab when active", () => {
    const { result } = mount();
    act(() => result.current.setLeafCwd(2, "/somewhere"));
    const t = terminalAt(result.current.tabs, 1);
    expect(t.cwd).toBe("/somewhere");
    expect(t.paneTree).toMatchObject({ id: 2, cwd: "/somewhere" });
  });

  it("setLeafCwd does not touch the tab cwd for an inactive leaf", () => {
    const { result } = mount({ cwd: "/base" });
    let leaf: number | null = null;
    act(() => {
      leaf = result.current.splitActivePane(1, "row");
    });
    act(() => result.current.focusPane(1, 2));
    act(() => result.current.setLeafCwd(leaf as number, "/elsewhere"));
    const t = terminalAt(result.current.tabs, 1);
    expect(t.cwd).toBe("/base");
  });

  it("setLeafCwd bails out without a state change when nothing changed", () => {
    const { result } = mount({ cwd: "/base" });
    act(() => result.current.setLeafCwd(2, "/base"));
    const before = result.current.tabs;
    act(() => result.current.setLeafCwd(2, "/base"));
    expect(result.current.tabs).toBe(before);
  });

  it("focusPane activates a leaf and adopts its cwd", () => {
    const { result } = mount({ cwd: "/base" });
    let leaf = 0;
    act(() => {
      leaf = result.current.splitActivePane(1, "row") as number;
    });
    act(() => result.current.setLeafCwd(leaf, "/split"));
    act(() => result.current.focusPane(1, 2));
    let t = terminalAt(result.current.tabs, 1);
    expect(t.activeLeafId).toBe(2);
    expect(t.cwd).toBe("/base");
    act(() => result.current.focusPane(1, leaf));
    t = terminalAt(result.current.tabs, 1);
    expect(t.activeLeafId).toBe(leaf);
    expect(t.cwd).toBe("/split");
  });

  it("focusPane ignores unknown leaves", () => {
    const { result } = mount();
    const before = result.current.tabs;
    act(() => result.current.focusPane(1, 999));
    expect(result.current.tabs).toEqual(before);
    expect(terminalAt(result.current.tabs, 1).activeLeafId).toBe(2);
  });

  it("focusNextPaneInTab cycles through leaves", () => {
    const { result } = mount();
    let leaf = 0;
    act(() => {
      leaf = result.current.splitActivePane(1, "row") as number;
    });
    act(() => result.current.focusNextPaneInTab(1, 1));
    expect(terminalAt(result.current.tabs, 1).activeLeafId).toBe(2);
    act(() => result.current.focusNextPaneInTab(1, -1));
    expect(terminalAt(result.current.tabs, 1).activeLeafId).toBe(leaf);
  });

  it("closeActivePane collapses a split back to the sibling", () => {
    const { result } = mount();
    let leaf = 0;
    act(() => {
      leaf = result.current.splitActivePane(1, "row") as number;
    });
    let closedTab = true;
    act(() => {
      closedTab = result.current.closeActivePane(1);
    });
    expect(closedTab).toBe(false);
    const t = terminalAt(result.current.tabs, 1);
    expect(leafIds(t.paneTree)).toEqual([2]);
    expect(t.activeLeafId).toBe(2);
    expect(disposeSession).toHaveBeenCalledWith(leaf);
  });

  it("closeActivePane closes the whole tab when its last pane goes", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
    });
    let closedTab = false;
    act(() => {
      closedTab = result.current.closeActivePane(id);
    });
    expect(closedTab).toBe(true);
    expect(result.current.tabs.map((t) => t.id)).toEqual([1]);
    expect(result.current.activeId).toBe(1);
  });

  it("closeActivePane refuses the last pane of the last tab in a rig", () => {
    const { result } = mount();
    let closedTab = true;
    act(() => {
      closedTab = result.current.closeActivePane(1);
    });
    expect(closedTab).toBe(false);
    expect(result.current.tabs).toHaveLength(1);
    expect(disposeSession).not.toHaveBeenCalled();
  });

  it("closePaneByLeaf removes the leaf wherever it lives", () => {
    const { result } = mount();
    let leaf = 0;
    act(() => {
      leaf = result.current.splitActivePane(1, "row") as number;
    });
    act(() => result.current.closePaneByLeaf(leaf));
    expect(leafIds(terminalAt(result.current.tabs, 1).paneTree)).toEqual([2]);
    expect(disposeSession).toHaveBeenCalledWith(leaf);
  });

  it("closePaneByLeaf closes the tab when it was the only leaf", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
    });
    const leaf = terminalAt(result.current.tabs, id).activeLeafId;
    act(() => result.current.closePaneByLeaf(leaf));
    expect(result.current.tabs.map((t) => t.id)).toEqual([1]);
    expect(disposeSession).toHaveBeenCalledWith(leaf);
  });

  it("closePaneByLeaf ignores unknown leaves", () => {
    const { result } = mount();
    act(() => result.current.closePaneByLeaf(999));
    expect(result.current.tabs).toHaveLength(1);
    expect(disposeSession).not.toHaveBeenCalled();
  });
});

describe("rig operations", () => {
  it("moveTabToRig reassigns an inactive tab without following", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
    });
    act(() => result.current.setActiveId(1));
    let follow = true;
    act(() => {
      follow = result.current.moveTabToRig(id, "s2");
    });
    expect(follow).toBe(false);
    expect(result.current.tabs.find((t) => t.id === id)?.rigId).toBe("s2");
  });

  it("moveTabToRig falls back when the active tab leaves its rig", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
    });
    let follow = true;
    act(() => {
      follow = result.current.moveTabToRig(id, "s2");
    });
    expect(follow).toBe(false);
    expect(result.current.activeId).toBe(1);
  });

  it("moveTabToRig asks the caller to follow when the source empties", () => {
    const { result } = mount();
    let follow = false;
    act(() => {
      follow = result.current.moveTabToRig(1, "s2");
    });
    expect(follow).toBe(true);
    expect(result.current.tabs[0].rigId).toBe("s2");
  });

  it("moveTabToRig is a no-op for same-rig or unknown tabs", () => {
    const { result } = mount();
    let follow = true;
    act(() => {
      follow = result.current.moveTabToRig(1, "default");
    });
    expect(follow).toBe(false);
    act(() => {
      follow = result.current.moveTabToRig(999, "s2");
    });
    expect(follow).toBe(false);
  });

  it("reorderTab repositions within the same rig", () => {
    const { result } = mount();
    let b = 0;
    let c = 0;
    act(() => {
      b = result.current.newTab();
    });
    act(() => {
      c = result.current.newTab();
    });
    act(() => {
      result.current.reorderTab(c, 1, "top");
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual([c, 1, b]);
    act(() => {
      result.current.reorderTab(c, b, "bottom");
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual([1, b, c]);
  });

  it("reorderTab moves a tab into the target's rig", () => {
    const { result } = mount();
    let other = 0;
    let mover = 0;
    act(() => {
      other = result.current.newTabInRig("s2");
    });
    act(() => {
      mover = result.current.newTab();
    });
    act(() => result.current.setActiveId(1));
    let follow = true;
    act(() => {
      follow = result.current.reorderTab(mover, other, "bottom");
    });
    expect(follow).toBe(false);
    expect(result.current.tabs.find((t) => t.id === mover)?.rigId).toBe("s2");
  });

  it("reorderTab asks the caller to follow across rigs when the source empties", () => {
    const { result } = mount();
    let other = 0;
    act(() => {
      other = result.current.newTabInRig("s2");
    });
    let follow = false;
    act(() => {
      follow = result.current.reorderTab(1, other, "top");
    });
    expect(follow).toBe(true);
    const ids = result.current.tabs.map((t) => t.id);
    expect(ids).toEqual([1, other]);
    expect(result.current.tabs[0].rigId).toBe("s2");
  });

  it("reorderTab ignores self and unknown targets", () => {
    const { result } = mount();
    let follow = true;
    act(() => {
      follow = result.current.reorderTab(1, 1, "top");
    });
    expect(follow).toBe(false);
    act(() => {
      follow = result.current.reorderTab(1, 999, "top");
    });
    expect(follow).toBe(false);
  });

  it("reorderTabByGap moves a tab to a strip gap", () => {
    const { result } = mount();
    let b = 0;
    act(() => {
      b = result.current.newTab();
    });
    act(() => result.current.reorderTabByGap(b, 0));
    expect(result.current.tabs.map((t) => t.id)).toEqual([b, 1]);
  });

  it("removeTabsForRig disposes leaves and spawns a cold fallback", () => {
    const { result } = mount();
    const leaves = leafIds(terminalAt(result.current.tabs, 1).paneTree);
    act(() => result.current.removeTabsForRig("default", "next", "/n"));
    for (const lid of leaves) expect(disposeSession).toHaveBeenCalledWith(lid);
    expect(result.current.tabs).toHaveLength(1);
    const t = result.current.tabs[0];
    expect(t.rigId).toBe("next");
    expect(t.cold).toBe(true);
    expect(result.current.activeId).toBe(t.id);
  });

  it("removeTabsForRig reuses existing fallback tabs", () => {
    const { result } = mount();
    let other = 0;
    act(() => {
      other = result.current.newTabInRig("next");
    });
    act(() => result.current.removeTabsForRig("default", "next"));
    expect(result.current.tabs.map((t) => t.id)).toEqual([other]);
    expect(result.current.activeId).toBe(other);
  });

  it("removeTabsForRig is a no-op for an unknown rig", () => {
    const { result } = mount();
    act(() => result.current.removeTabsForRig("ghost", "default"));
    expect(result.current.tabs).toHaveLength(1);
    expect(disposeSession).not.toHaveBeenCalled();
  });
});

describe("workspace level", () => {
  it("replaceTabs installs a new list and active id", () => {
    const { result } = mount();
    const next: Tab[] = [
      {
        id: 50,
        kind: "terminal",
        rigId: "default",
        title: "shell",
        paneTree: { kind: "leaf", id: 51 },
        activeLeafId: 51,
      },
    ];
    act(() => result.current.replaceTabs(next, 50));
    expect(result.current.tabs).toEqual(next);
    expect(result.current.activeId).toBe(50);
  });

  it("replaceTabs refuses an empty list", () => {
    const { result } = mount();
    const before = result.current.tabs;
    act(() => result.current.replaceTabs([], 1));
    expect(result.current.tabs).toBe(before);
  });

  it("resetWorkspace replaces everything with one fresh tab", () => {
    const { result } = mount();
    let extra = 0;
    act(() => {
      extra = result.current.newTab();
    });
    const allLeaves = result.current.tabs.flatMap((t) =>
      t.kind === "terminal" ? leafIds(t.paneTree) : [],
    );
    act(() => result.current.resetWorkspace("/fresh"));
    expect(result.current.tabs).toHaveLength(1);
    const t = terminalAt(result.current.tabs, result.current.activeId);
    expect(t.cwd).toBe("/fresh");
    expect(t.id).not.toBe(extra);
    for (const lid of allLeaves)
      expect(disposeSession).toHaveBeenCalledWith(lid);
  });

  it("allocId hands out monotonically increasing ids", () => {
    const { result } = mount();
    const a = result.current.allocId();
    const b = result.current.allocId();
    expect(b).toBe(a + 1);
  });
});

/**
 * React 19 defers setState updaters to render for every dispatch after the
 * first in a batch. These tests lock the invariant that useTabs plans results
 * and side effects (return ids, setActiveId, disposeSession) outside the
 * dispatch, so nothing is lost when the updater path is deferred.
 */
describe("deferred-dispatch regressions", () => {
  it("closeTab disposes sessions when its dispatch is deferred in a batch", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newTab();
      result.current.closeTab(id);
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual([1]);
    expect(result.current.activeId).toBe(1);
    expect(disposeSession).toHaveBeenCalledTimes(1);
    expect(disposeSession).toHaveBeenCalledWith(id + 1);
  });

  it("closeActivePane reports the tab close from a deferred dispatch", () => {
    const { result } = mount();
    let id = 0;
    let closed = false;
    act(() => {
      id = result.current.newTab();
      closed = result.current.closeActivePane(id);
    });
    expect(closed).toBe(true);
    expect(result.current.tabs.map((t) => t.id)).toEqual([1]);
    expect(result.current.activeId).toBe(1);
    expect(disposeSession).toHaveBeenCalledWith(id + 1);
  });

  it("splitActivePane splits a tab created in the same batch and returns the leaf", () => {
    const { result } = mount();
    let id = 0;
    let leaf: number | null = null;
    act(() => {
      id = result.current.newTab();
      leaf = result.current.splitActivePane(id, "row");
    });
    expect(leaf).not.toBeNull();
    expect(leafIds(terminalAt(result.current.tabs, id).paneTree)).toHaveLength(
      2,
    );
    expect(terminalAt(result.current.tabs, id).activeLeafId).toBe(leaf);
  });

  it("closePaneByLeaf disposes a leaf split in the same batch", () => {
    const { result } = mount();
    let leaf = 0;
    act(() => {
      leaf = result.current.splitActivePane(1, "row") as number;
      result.current.closePaneByLeaf(leaf);
    });
    expect(leafIds(terminalAt(result.current.tabs, 1).paneTree)).toEqual([2]);
    expect(disposeSession).toHaveBeenCalledWith(leaf);
  });

  it("removeTabsForRig disposes leaves within one batch", () => {
    const { result } = mount();
    let other = 0;
    act(() => {
      other = result.current.newTabInRig("next");
      result.current.removeTabsForRig("default", "next");
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual([other]);
    expect(result.current.activeId).toBe(other);
    expect(disposeSession).toHaveBeenCalledWith(2);
  });

  it("resetWorkspace disposes every leaf within one batch", () => {
    const { result } = mount();
    let extra = 0;
    act(() => {
      extra = result.current.newTab();
      result.current.resetWorkspace("/fresh");
    });
    expect(result.current.tabs).toHaveLength(1);
    expect(terminalAt(result.current.tabs, result.current.activeId).cwd).toBe(
      "/fresh",
    );
    expect(disposeSession).toHaveBeenCalledWith(2);
    expect(disposeSession).toHaveBeenCalledWith(extra + 1);
  });
});

describe("newTabRightOf", () => {
  it("inserts a fresh terminal right after the anchor and activates it", () => {
    const { result } = mount();
    let id2 = 0;
    act(() => {
      id2 = result.current.newTab(); // [1, 2]
    });
    let id3 = 0;
    act(() => {
      id3 = result.current.newTabRightOf(1); // insert after 1 → [1, 3, 2]
    });
    expect(result.current.tabs.map((t) => t.id)).toEqual([1, id3, id2]);
    expect(result.current.activeId).toBe(id3);
    expect(terminalAt(result.current.tabs, id3).kind).toBe("terminal");
  });
});

describe("duplicateTab", () => {
  it("duplicates a terminal into an adjacent tab with a fresh leaf", () => {
    const { result } = mount();
    const src = terminalAt(result.current.tabs, 1);
    act(() => result.current.duplicateTab(1));
    expect(result.current.tabs).toHaveLength(2);
    const dup = result.current.tabs[1];
    expect(dup.id).not.toBe(1);
    expect(dup.kind).toBe("terminal");
    expect(terminalAt(result.current.tabs, dup.id).activeLeafId).not.toBe(
      src.activeLeafId,
    );
    expect(result.current.activeId).toBe(dup.id);
  });
});

describe("preview tabs", () => {
  it("newPreviewTab opens a normal preview tab in the main pane and focuses it", () => {
    const { result } = mount();
    let id = 0;
    act(() => {
      id = result.current.newPreviewTab("http://localhost:3000");
    });
    const t = result.current.tabs.find((x) => x.id === id);
    expect(t?.kind).toBe("preview");
    expect(result.current.activeId).toBe(id);
  });
});

describe("split view", () => {
  it("setSplit opens a tab in the right pane; closeSplit clears it", () => {
    const { result } = mount();
    let a = 0;
    let b = 0;
    act(() => {
      a = result.current.newPreviewTab("http://a");
      b = result.current.newPreviewTab("http://b");
    });
    // b is active; split with a → a in the right pane, b stays active (left).
    act(() => result.current.setSplit(a));
    expect(result.current.splitTabId).toBe(a);
    expect(result.current.activeId).toBe(b);

    act(() => result.current.closeSplit());
    expect(result.current.splitTabId).toBe(0);
  });

  it("setSplit on the active tab moves the active tab elsewhere (never both panes)", () => {
    const { result } = mount();
    let a = 0;
    act(() => {
      a = result.current.newPreviewTab("http://a");
    });
    expect(result.current.activeId).toBe(a);
    // Split with the active tab → it becomes the split tab; active moves away.
    act(() => result.current.setSplit(a));
    expect(result.current.splitTabId).toBe(a);
    expect(result.current.activeId).not.toBe(a);
  });

  it("closing the split tab clears the split", () => {
    const { result } = mount();
    let a = 0;
    let b = 0;
    act(() => {
      a = result.current.newPreviewTab("http://a");
      b = result.current.newPreviewTab("http://b");
    });
    act(() => result.current.setSplit(a));
    expect(result.current.splitTabId).toBe(a);
    act(() => result.current.closeTab(a));
    expect(result.current.splitTabId).toBe(0);
    expect(result.current.tabs.find((t) => t.id === a)).toBeUndefined();
    void b;
  });
});

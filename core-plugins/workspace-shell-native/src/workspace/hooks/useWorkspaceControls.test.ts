// @vitest-environment jsdom
import type { Tab } from "../tabs";
import type { WorkspaceRigsCapability } from "@termco/workspace-base";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceControls } from "./useWorkspaceControls";

const rigsState = vi.hoisted(() => ({
  activeId: "s1" as string | null,
  activate: vi.fn(),
}));

const rigs = {
  snapshot: () => ({ activeId: rigsState.activeId }),
  activate: rigsState.activate,
} as unknown as WorkspaceRigsCapability;

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  rigsState.activeId = "s1";
});

function terminal(id: number, leaves: number[], rigId = "s1"): Tab {
  return {
    id,
    kind: "terminal",
    title: `t${id}`,
    rigId,
    paneTree:
      leaves.length === 1
        ? { kind: "leaf", id: leaves[0] }
        : {
            kind: "split",
            id: 100,
            dir: "row",
            children: leaves.map((l) => ({ kind: "leaf" as const, id: l })),
          },
    activeLeafId: leaves[0],
  };
}

function editor(id: number): Tab {
  return {
    id,
    kind: "editor",
    title: "e",
    rigId: "s1",
    path: "/f.ts",
    dirty: false,
    preview: false,
  };
}

function setup(over?: { activeId?: number; tabs?: Tab[] }) {
  const api = {
    newPreviewTab: vi.fn(() => 42),
    splitActivePane: vi.fn(),
    closeActivePane: vi.fn(() => true),
    setActiveId: vi.fn(),
    focusPane: vi.fn(),
    handleClose: vi.fn(),
  };
  const render = renderHook(() =>
    useWorkspaceControls({
      ...api,
      activeId: over?.activeId ?? 1,
      tabsRef: { current: over?.tabs ?? [] },
      rigs,
    }),
  );
  return { ...render, ...api };
}

describe("openPreviewTab", () => {
  it("opens the tab and returns its id", () => {
    const s = setup();
    const id = s.result.current.openPreviewTab("");
    expect(id).toBe(42);
    expect(s.newPreviewTab).toHaveBeenCalledWith("");
  });

  it("passes a provided url to the tab creator", () => {
    const s = setup();
    s.result.current.openPreviewTab("http://localhost:3000");
    expect(s.newPreviewTab).toHaveBeenCalledWith("http://localhost:3000");
  });
});

describe("splitActivePaneInActiveTab", () => {
  it("splits the active terminal tab", () => {
    const s = setup({ activeId: 1, tabs: [terminal(1, [10])] });
    s.result.current.splitActivePaneInActiveTab("row");
    expect(s.splitActivePane).toHaveBeenCalledWith(1, "row");
  });

  it("refuses to split non-terminal tabs", () => {
    const s = setup({ activeId: 2, tabs: [editor(2)] });
    s.result.current.splitActivePaneInActiveTab("col");
    expect(s.splitActivePane).not.toHaveBeenCalled();
  });
});

describe("handleCloseTabOrPane", () => {
  it("closes just the pane in a split terminal", () => {
    const s = setup({ activeId: 1, tabs: [terminal(1, [10, 11])] });
    s.result.current.handleCloseTabOrPane();
    expect(s.closeActivePane).toHaveBeenCalledWith(1);
    expect(s.handleClose).not.toHaveBeenCalled();
  });

  it("closes the tab for a single-pane terminal", () => {
    const s = setup({ activeId: 1, tabs: [terminal(1, [10])] });
    s.result.current.handleCloseTabOrPane();
    expect(s.handleClose).toHaveBeenCalledWith(1);
    expect(s.closeActivePane).not.toHaveBeenCalled();
  });

  it("closes the tab for non-terminal tabs", () => {
    const s = setup({ activeId: 2, tabs: [editor(2)] });
    s.result.current.handleCloseTabOrPane();
    expect(s.handleClose).toHaveBeenCalledWith(2);
  });
});

describe("zen mode", () => {
  it("starts disabled and toggles via the setter", () => {
    const s = setup();
    expect(s.result.current.zenMode).toBe(false);
    act(() => s.result.current.setZenMode(true));
    expect(s.result.current.zenMode).toBe(true);
  });
});

describe("activateAgentTarget", () => {
  it("switches rig first when the tab lives elsewhere", () => {
    const s = setup({ tabs: [terminal(1, [10], "s2")] });
    s.result.current.activateAgentTarget(1, 10);
    expect(rigsState.activate).toHaveBeenCalledWith("s2");
    expect(s.setActiveId).toHaveBeenCalledWith(1);
    expect(s.focusPane).toHaveBeenCalledWith(1, 10);
  });

  it("skips the rig switch when already active", () => {
    const s = setup({ tabs: [terminal(1, [10], "s1")] });
    s.result.current.activateAgentTarget(1, 10);
    expect(rigsState.activate).not.toHaveBeenCalled();
    expect(s.setActiveId).toHaveBeenCalledWith(1);
    expect(s.focusPane).toHaveBeenCalledWith(1, 10);
  });
});

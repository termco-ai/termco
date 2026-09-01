// @vitest-environment jsdom
import type { ResizablePanel } from "@termco/ui";
import type { Tab } from "../tabs";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceColumn } from "./WorkspaceColumn";
import type { SurfaceHost } from "./SurfaceHost";

type PanelProps = ComponentProps<typeof ResizablePanel>;
type SurfaceProps = ComponentProps<typeof SurfaceHost>;

const captured = vi.hoisted(() => ({
  panel: null as PanelProps | null,
  surface: null as SurfaceProps | null,
  surfaces: [] as SurfaceProps[],
}));

vi.mock("@termco/ui", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@termco/ui")>();
  return {
    ...original,
    ResizablePanel: (p: PanelProps) => {
      captured.panel = p;
      return <div data-testid="panel">{p.children}</div>;
    },
    ResizablePanelGroup: (p: { children?: unknown }) => (
      <div data-testid="panel-group">{p.children as never}</div>
    ),
    ResizableHandle: () => <div data-testid="handle" />,
  };
});

vi.mock("./SurfaceHost", () => ({
  SurfaceHost: (p: SurfaceProps) => {
    captured.surface = p;
    captured.surfaces.push(p);
    return <div data-testid="surface" />;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  captured.panel = null;
  captured.surface = null;
  captured.surfaces = [];
});

const terminalTab: Tab = {
  id: 1,
  kind: "terminal",
  title: "t",
  rigId: "default",
  paneTree: { kind: "leaf", id: 10 },
  activeLeafId: 10,
};
const presentation = { Icon: () => <span data-testid="tab-icon" /> };

type SplitOverrides = {
  splitTab?: Tab;
  splitTabId?: number;
  focusedPane?: "left" | "right";
  onFocusPane?: (p: "left" | "right") => void;
  onClosePane?: (p: "left" | "right") => void;
};

function setup(split: SplitOverrides = {}) {
  render(
    <WorkspaceColumn
      presentation={presentation}
      tabs={[terminalTab]}
      activeId={1}
      activeTab={terminalTab}
      contributions={[]}
      createRuntime={vi.fn() as never}
      splitTab={split.splitTab}
      splitTabId={split.splitTabId ?? 0}
      focusedPane={split.focusedPane ?? "left"}
      onFocusPane={split.onFocusPane ?? vi.fn()}
      onClosePane={split.onClosePane ?? vi.fn()}
    />,
  );
}

describe("WorkspaceColumn", () => {
  it("renders the surface inside the panel (input bar lives in the ai plugin's footer slot)", () => {
    setup();
    expect(screen.getByTestId("panel")).toBeTruthy();
    expect(screen.getByTestId("surface")).toBeTruthy();
    expect(captured.panel?.defaultSize).toBe("78%");
    expect(captured.panel?.minSize).toBe("30%");
  });

  it("uses the profile-selected tab presentation in split chrome", () => {
    setup({
      splitTab: {
        id: 2,
        kind: "preview",
        title: "localhost",
        rigId: "default",
        url: "http://localhost:3000",
      },
      splitTabId: 2,
    });
    expect(screen.getAllByTestId("tab-icon")).toHaveLength(2);
  });

  it("threads the tab population into the surface host untouched", () => {
    setup();
    expect(captured.surface?.tabs).toEqual([terminalTab]);
    expect(captured.surface?.activeId).toBe(1);
    expect(captured.surface?.activeTab).toBe(terminalTab);
    expect(captured.surface?.contributions).toEqual([]);
  });

  it("renders a single surface when there's no split", () => {
    setup();
    expect(captured.surfaces).toHaveLength(1);
    expect(screen.queryByTestId("panel-group")).toBeNull();
  });

  it("splits into two surfaces with disjoint tabs when a split tab is set", () => {
    const splitTab: Tab = {
      id: 2,
      kind: "preview",
      title: "localhost",
      rigId: "default",
      url: "http://localhost:3000",
    };
    setup({ splitTab, splitTabId: 2, focusedPane: "left" });
    // Two surfaces side by side in a panel group.
    expect(captured.surfaces).toHaveLength(2);
    expect(screen.getByTestId("panel-group")).toBeTruthy();
    const [left, right] = captured.surfaces;
    // Left = the primary surface (its own tabs); right = only the split tab.
    expect(left.tabs).toEqual([terminalTab]);
    expect(left.activeId).toBe(1);
    expect(right.tabs).toEqual([splitTab]);
    expect(right.activeId).toBe(2);
    expect(right.activeTab).toBe(splitTab);
    expect(left.contributions).toBe(right.contributions);
    expect(left.createRuntime).toBe(right.createRuntime);
  });

  it("closes either pane from its × button", () => {
    const onClosePane = vi.fn();
    const splitTab: Tab = {
      id: 2,
      kind: "preview",
      title: "localhost",
      rigId: "default",
      url: "http://localhost:3000",
    };
    setup({ splitTab, splitTabId: 2, onClosePane });
    // Both panes now carry a close button; each targets its own side.
    screen.getByLabelText("Close left pane").click();
    expect(onClosePane).toHaveBeenLastCalledWith("left");
    screen.getByLabelText("Close right pane").click();
    expect(onClosePane).toHaveBeenLastCalledWith("right");
  });
});

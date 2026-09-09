// @vitest-environment jsdom
import type { ResizablePanel } from "@termco/ui";
import type { Tab } from "../tabs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceColumn } from "./WorkspaceColumn";
import type { SurfaceHost } from "./SurfaceHost";
import type { DockPane } from "../hooks/usePaneDocking";

type PanelProps = ComponentProps<typeof ResizablePanel>;
type SurfaceProps = ComponentProps<typeof SurfaceHost>;

const captured = vi.hoisted(() => ({
  mounts: 0,
  panel: null as PanelProps | null,
  surface: null as SurfaceProps | null,
  surfaces: [] as SurfaceProps[],
}));

vi.mock("@termco/ui", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@termco/ui")>();
  return {
    ...original,
    ResizablePanel: (p: PanelProps) => {
      if (p.id === "workspace") captured.panel = p;
      return <div data-testid={p.id === "workspace" ? "panel" : p.id}>{p.children}</div>;
    },
    ResizablePanelGroup: (p: { children?: unknown; orientation?: string }) => (
      <div data-testid="panel-group" data-orientation={p.orientation}>{p.children as never}</div>
    ),
    ResizableHandle: () => <div data-testid="handle" />,
  };
});

vi.mock("./SurfaceHost", () => ({
  SurfaceHost: (p: SurfaceProps) => {
    useEffect(() => { captured.mounts++; }, []);
    captured.surface = p;
    captured.surfaces.push(p);
    return <div data-testid="surface" />;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  captured.panel = null;
  captured.mounts = 0;
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
  splitDirection?: "horizontal" | "vertical";
  focusedPane?: "left" | "right";
  onFocusPane?: (p: "left" | "right") => void;
  onClosePane?: (p: "left" | "right") => void;
  onDockPane?: DockPane;
};

function setup(split: SplitOverrides = {}) {
  return render(
    <WorkspaceColumn
      presentation={presentation}
      tabs={[terminalTab]}
      activeId={1}
      activeTab={terminalTab}
      contributions={[]}
      createRuntime={vi.fn() as never}
      splitTab={split.splitTab}
      splitTabId={split.splitTabId ?? 0}
      splitDirection={split.splitDirection}
      focusedPane={split.focusedPane ?? "left"}
      onFocusPane={split.onFocusPane ?? vi.fn()}
      onClosePane={split.onClosePane ?? vi.fn()}
      onDockPane={split.onDockPane}
    />,
  );
}

describe("WorkspaceColumn", () => {
  function setupDocking() {
    const onDockPane = vi.fn();
    const view = setup({ splitTab: { ...terminalTab, id: 2 }, splitTabId: 2, onDockPane });
    const surface = view.container.querySelector("[data-workspace-surface]")!;
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 1000, 600));
    const handles = Array.from(view.container.querySelectorAll<HTMLElement>("[data-pane-drag-handle]"));
    for (const handle of handles) {
      let captured = false;
      handle.setPointerCapture = vi.fn(() => { captured = true; });
      handle.hasPointerCapture = vi.fn(() => captured);
      handle.releasePointerCapture = vi.fn(() => { captured = false; });
    }
    return { ...view, handles, onDockPane };
  }

  it("lets either placed pane move repeatedly by its own title bar", () => {
    const { handles, onDockPane } = setupDocking();
    for (const [index, pane] of ["left", "right"].entries()) {
      const handle = handles[index];
      for (const [x, y, direction, placement, position] of [
        [1050, 400, "horizontal", "after", "right"],
        [600, 110, "vertical", "before", "top"],
        [600, 680, "vertical", "after", "bottom"],
      ] as const) {
        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 600, clientY: 400 });
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: x, clientY: y });
        expect(screen.getByTestId("pane-dock-drop-indicator").dataset.dockPosition).toBe(position);
        fireEvent.pointerUp(handle, { pointerId: 1, clientX: x, clientY: y });
        expect(onDockPane).toHaveBeenLastCalledWith(pane, direction, placement);
        expect(screen.queryByTestId("pane-dock-drop-indicator")).toBeNull();
        expect(handle.hasPointerCapture(1)).toBe(false);
      }
    }
    expect(onDockPane).toHaveBeenCalledTimes(6);
    expect(captured.mounts).toBe(2);
  });

  it.each(["Escape", "blur", "pointercancel", "lostpointercapture", "unmount"])(
    "cancels a pane drag on %s and restores text selection", (reason) => {
      const { handles: [handle], onDockPane, unmount } = setupDocking();
      document.body.style.userSelect = "text";
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 600, clientY: 400 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600, clientY: 680 });
      expect(document.body.style.userSelect).toBe("none");
      if (reason === "Escape") fireEvent.keyDown(window, { key: "Escape" });
      else if (reason === "blur") fireEvent.blur(window);
      else if (reason === "pointercancel") fireEvent.pointerCancel(handle, { pointerId: 1 });
      else if (reason === "lostpointercapture") fireEvent.lostPointerCapture(handle, { pointerId: 1 });
      else unmount();
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 600, clientY: 680 });
      expect(onDockPane).not.toHaveBeenCalled();
      expect(screen.queryByTestId("pane-dock-drop-indicator")).toBeNull();
      expect(document.body.style.userSelect).toBe("text");
      document.body.style.userSelect = "";
    },
  );

  it("does not move panes on a click, a close-button press, or a central/outside drop", () => {
    const { handles: [handle], onDockPane } = setupDocking();
    fireEvent.pointerDown(screen.getByLabelText("Close left pane"), { button: 0, pointerId: 1 });
    expect(handle.setPointerCapture).not.toHaveBeenCalled();
    for (const [x, y] of [[601, 400], [650, 400], [50, 400]]) {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 600, clientY: 400 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: x, clientY: y });
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: x, clientY: y });
    }
    expect(onDockPane).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe("");
  });

  it("retains the primary host when opening, rotating, and closing a split", () => {
    const props = { presentation, tabs: [terminalTab], activeId: 1, activeTab: terminalTab,
      contributions: [], createRuntime: vi.fn() as never, splitTabId: 0,
      focusedPane: "left" as const, onFocusPane: vi.fn(), onClosePane: vi.fn() };
    const { rerender } = render(<WorkspaceColumn {...props} splitTab={undefined} />);
    expect(captured.mounts).toBe(1);
    const splitTab = { ...terminalTab, id: 2 };
    rerender(<WorkspaceColumn {...props} splitTab={splitTab} splitTabId={2} splitDirection="vertical" />);
    expect(captured.mounts).toBe(2);
    rerender(<WorkspaceColumn {...props} splitTab={splitTab} splitTabId={2} splitDirection="horizontal" />);
    expect(captured.mounts).toBe(2);
    rerender(<WorkspaceColumn {...props} splitTab={splitTab} splitTabId={2} splitDirection="vertical" splitPlacement="before" />);
    expect(captured.mounts).toBe(2);
    const panels = screen.getByTestId("panel-group").querySelectorAll('[data-testid^="ws-"]');
    expect(Array.from(panels).map((panel) => panel.getAttribute("data-testid"))).toEqual(["ws-right", "ws-left"]);
    rerender(<WorkspaceColumn {...props} splitTab={undefined} />);
    expect(captured.mounts).toBe(2);
  });

  it("stacks the secondary terminal below the primary surface and routes focus and close", () => {
    const onFocusPane = vi.fn();
    const onClosePane = vi.fn();
    setup({ splitTab: { ...terminalTab, id: 2 }, splitTabId: 2,
      splitDirection: "vertical", onFocusPane, onClosePane });
    expect(screen.getByTestId("panel-group").dataset.orientation).toBe("vertical");
    fireEvent.pointerDown(screen.getByLabelText("Close bottom pane"));
    expect(onFocusPane).toHaveBeenLastCalledWith("right");
    screen.getByLabelText("Close bottom pane").click();
    expect(onClosePane).toHaveBeenLastCalledWith("right");
    screen.getByLabelText("Close top pane").click();
    expect(onClosePane).toHaveBeenLastCalledWith("left");
  });

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
    expect(screen.queryByTestId("handle")).toBeNull();
    expect(screen.queryByLabelText("Close left pane")).toBeNull();
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

// @vitest-environment jsdom
import type { UiSidebarViewContribution, UiSidebarViewProps } from "@termco/ui-sidebar-base";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SidebarPanel,
  type SidebarViewEntry,
} from "./SidebarPanel";

type PanelProps = {
  children?: ReactNode;
  defaultSize?: string;
  minSize?: string;
  maxSize?: string;
  collapsible?: boolean;
  collapsedSize?: string;
  onResize?: (size: { inPixels: number }) => void;
};

const captured = vi.hoisted(() => ({ panel: null as PanelProps | null }));

vi.mock("@termco/ui", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@termco/ui")>();
  return {
    ...original,
    ResizablePanel: (props: PanelProps) => {
      captured.panel = props;
      return <div data-testid="panel">{props.children}</div>;
    },
  };
});

const ICON = [["svg", {}]] as unknown as UiSidebarViewContribution["icon"];
const value = (
  id: string,
  label: string,
  testId: string,
): UiSidebarViewContribution => ({
  id,
  label,
  description: `${label} view`,
  icon: ICON,
  Component: () => <div data-testid={testId} />,
});
const VIEWS: SidebarViewEntry[] = [
  { pluginId: "explorer-sidebar", generation: "test-generation", key: "explorer", value: value("explorer", "Files", "explorer") },
  { pluginId: "source-control-sidebar", generation: "test-generation", key: "source-control", value: value("source-control", "Source Control", "source-control") },
  { pluginId: "ports-sidebar", generation: "test-generation", key: "ports", value: value("ports", "Ports", "ports") },
];
const viewProps: UiSidebarViewProps = {
  rootPath: "/repo",
  workspace: { kind: "local" },
  activeFilePath: null,
  openFileAt: vi.fn(),
  openFile: vi.fn(),
  navigateToPath: vi.fn(),
  pathRenamed: vi.fn(),
  pathDeleted: vi.fn(),
  attachFileToAgent: vi.fn(),
  runInNewTerminal: vi.fn(async () => {}),
};

afterEach(() => {
  cleanup();
  captured.panel = null;
});

function setup(over?: {
  sidebarView?: string;
  initialSidebarCollapsed?: boolean;
  views?: readonly SidebarViewEntry[];
}) {
  const fns = {
    persistSidebarWidth: vi.fn(),
    persistSidebarCollapsed: vi.fn(),
    persistSidebarView: vi.fn(),
  };
  render(
    <SidebarPanel
      sidebarRef={{ current: null }}
      sidebarWidthRef={{ current: 308 }}
      initialSidebarCollapsed={over?.initialSidebarCollapsed ?? false}
      sidebarView={over?.sidebarView ?? "explorer"}
      views={over?.views ?? VIEWS}
      viewProps={viewProps}
      {...fns}
    />,
  );
  return fns;
}

describe("SidebarPanel", () => {
  it("sizes the panel from the established stored-width bounds", () => {
    setup();
    expect(captured.panel?.defaultSize).toBe("308px");
    expect(captured.panel?.minSize).toBe(`${SIDEBAR_MIN_WIDTH}px`);
    expect(captured.panel?.maxSize).toBe(`${SIDEBAR_MAX_WIDTH}px`);
    expect(captured.panel?.collapsible).toBe(true);
    expect(captured.panel?.collapsedSize).toBe("48px");
  });

  it("keeps the workspace menu visible when content is collapsed", () => {
    setup({ initialSidebarCollapsed: true });
    expect(captured.panel?.defaultSize).toBe("48px");
  });

  it("persists width and expanded state on resize", () => {
    const fns = setup();
    captured.panel?.onResize?.({ inPixels: 300 });
    expect(fns.persistSidebarWidth).toHaveBeenCalledWith(300);
    expect(fns.persistSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it("persists only collapsed state at the activity-rail width", () => {
    const fns = setup();
    captured.panel?.onResize?.({ inPixels: 48 });
    expect(fns.persistSidebarWidth).not.toHaveBeenCalled();
    expect(fns.persistSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("mounts only the selected profile contribution", () => {
    setup({ sidebarView: "source-control" });
    expect(screen.getByTestId("source-control")).toBeTruthy();
    expect(screen.queryByTestId("explorer")).toBeNull();
  });

  it("falls back to the first contribution for an unknown stored id", () => {
    setup({ sidebarView: "missing" });
    expect(screen.getByTestId("explorer")).toBeTruthy();
    expect(screen.getByLabelText("Files").getAttribute("aria-pressed")).toBe("true");
  });

  it("renders an empty body and rail when no profile contributes a view", () => {
    setup({ views: [] });
    expect(screen.queryByTestId("explorer")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("wires every contribution directly to the activity rail", () => {
    const fns = setup();
    screen.getByLabelText("Source Control").click();
    screen.getByLabelText("Ports").click();
    expect(fns.persistSidebarView).toHaveBeenNthCalledWith(1, "source-control");
    expect(fns.persistSidebarView).toHaveBeenNthCalledWith(2, "ports");
  });
});

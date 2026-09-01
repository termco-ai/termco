// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppOverlays } from "./AppOverlays";
import { AppShell } from "./AppShell";
import type { SidebarPanel } from "./SidebarPanel";
import type { WorkspaceColumn } from "./WorkspaceColumn";

type ShellProps = ComponentProps<typeof AppShell>;

const captured = vi.hoisted(() => ({
  sidebar: null as ComponentProps<typeof SidebarPanel> | null,
  workspace: null as ComponentProps<typeof WorkspaceColumn> | null,
  overlays: null as ComponentProps<typeof AppOverlays> | null,
}));

vi.mock("@termco/ui", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  ResizablePanel: ({ children, id }: { children: ReactNode; id?: string }) => (
    <div data-testid={`panel-${id ?? "unknown"}`}>{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("./AppOverlays", () => ({
  AppOverlays: (p: ComponentProps<typeof AppOverlays>) => {
    captured.overlays = p;
    return <div data-testid="overlays" />;
  },
}));

vi.mock("./SidebarPanel", () => ({
  SidebarPanel: (p: ComponentProps<typeof SidebarPanel>) => {
    captured.sidebar = p;
    return <div data-testid="sidebar" />;
  },
}));

vi.mock("./WorkspaceColumn", () => ({
  WorkspaceColumn: (p: ComponentProps<typeof WorkspaceColumn>) => {
    captured.workspace = p;
    return <div data-testid="workspace" />;
  },
}));

afterEach(() => {
  cleanup();
});
beforeEach(() => {
  captured.sidebar = null;
  captured.workspace = null;
  captured.overlays = null;
});

function makeProps(over?: {
  settingsViewOpen?: boolean;
  agentsViewOpen?: boolean;
}): ShellProps {
  return {
    settingsViewOpen: over?.settingsViewOpen ?? false,
    agentsViewOpen: over?.agentsViewOpen ?? false,
    sidebar: { sidebarMarker: true } as unknown as ShellProps["sidebar"],
    workspace: {
      workspaceMarker: true,
    } as unknown as ShellProps["workspace"],
    overlays: { overlaysMarker: true } as unknown as ShellProps["overlays"],
  };
}

describe("AppShell", () => {
  it("renders no Theme/Tooltip providers and no header (CoreShell/plugins own them)", () => {
    // A second ThemeProvider here would double-write the theme fast-path —
    // since plugin-rewrite Phase 3 step 0 the providers live in CoreShell,
    // and since step 7 the header renders from the header plugin's slot host.
    render(<AppShell {...makeProps()} />);
    expect(screen.queryByTestId("theme-provider")).toBeNull();
    expect(screen.queryByTestId("tooltip-provider")).toBeNull();
    expect(screen.getByTestId("workspace")).toBeTruthy();
    expect(screen.getByTestId("overlays")).toBeTruthy();
  });

  it("lays out sidebar and workspace inside the resizable split", () => {
    render(<AppShell {...makeProps()} />);
    const group = screen.getByTestId("panel-group");
    expect(group.contains(screen.getByTestId("sidebar"))).toBe(true);
    expect(group.contains(screen.getByTestId("resize-handle"))).toBe(true);
    expect(group.contains(screen.getByTestId("workspace"))).toBe(true);
  });

  it("spreads the grouped props into each region", () => {
    render(<AppShell {...makeProps()} />);
    expect(captured.sidebar).toMatchObject({ sidebarMarker: true });
    expect(captured.workspace).toMatchObject({ workspaceMarker: true });
    expect(captured.overlays).toMatchObject({ overlaysMarker: true });
  });

  it("keeps the workspace mounted but hidden while settings owns the body", () => {
    // The settings VIEW renders from the settings plugin's workspace-slot
    // host; the shell only hides its own panel group underneath.
    const view = render(<AppShell {...makeProps()} />);
    view.rerender(
      <AppShell {...makeProps({ settingsViewOpen: true })} />,
    );
    const workspace = screen.getByTestId("workspace");
    expect(workspace).toBeTruthy();
    expect(workspace.closest(".hidden")).not.toBeNull();
  });

  it("hides the workspace while the agents view owns the body", () => {
    // The agents VIEW renders from the agents-manager plugin's workspace-
    // slot host (step 9d); the shell only hides its panel group underneath.
    const view = render(<AppShell {...makeProps()} />);
    view.rerender(<AppShell {...makeProps({ agentsViewOpen: true })} />);
    expect(screen.getByTestId("workspace").closest(".hidden")).not.toBeNull();
  });
});

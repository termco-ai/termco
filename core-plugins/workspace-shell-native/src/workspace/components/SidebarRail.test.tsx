// @vitest-environment jsdom
// The workspace-shell plugin owns the established activity-rail behavior.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarRail, type SidebarRailView } from "./SidebarRail";

afterEach(cleanup);

const ICON = [["svg", {}]] as unknown as SidebarRailView["icon"];

function views(changedCount = 0): SidebarRailView[] {
  return [
    {
      id: "explorer",
      pluginId: "explorer-sidebar",
      generation: "test-generation",
      contributionKey: "explorer",
      label: "Files",
      icon: ICON,
    },
    {
      id: "source-control",
      pluginId: "source-control-sidebar",
      generation: "test-generation",
      contributionKey: "source-control",
      label: "Source Control",
      icon: ICON,
      badge: () => changedCount,
    },
    {
      id: "ports",
      pluginId: "ports-sidebar",
      generation: "test-generation",
      contributionKey: "ports",
      label: "Ports",
      icon: ICON,
    },
  ];
}

function setup(over?: { activeView?: string; changedCount?: number }) {
  const onSelectView = vi.fn();
  render(
    <SidebarRail
      views={views(over?.changedCount ?? 0)}
      activeView={over?.activeView ?? "explorer"}
      onSelectView={onSelectView}
    />,
  );
  return onSelectView;
}

describe("SidebarRail", () => {
  it("renders the registered views with the active one pressed", () => {
    setup({ activeView: "source-control" });
    expect(screen.getByLabelText("Files").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(
      screen.getByLabelText("Source Control").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("selects a view on click", () => {
    const onSelectView = setup();
    fireEvent.click(screen.getByLabelText("Source Control"));
    expect(onSelectView).toHaveBeenCalledWith("source-control");
    fireEvent.click(screen.getByLabelText("Files"));
    expect(onSelectView).toHaveBeenCalledWith("explorer");
  });

  it("offers every registered view", () => {
    const onSelectView = setup();
    fireEvent.click(screen.getByLabelText("Ports"));
    expect(onSelectView).toHaveBeenCalledWith("ports");
  });

  it("exposes labels but no count when the badge hook returns 0", () => {
    setup({ changedCount: 0 });
    expect(screen.getByLabelText("Source Control").title).toBe(
      "Source Control",
    );
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows the badge value from the view's badge hook", () => {
    setup({ changedCount: 7 });
    expect(screen.getByText("7")).toBeDefined();
  });

  it("caps the badge at 99+", () => {
    setup({ changedCount: 250 });
    expect(screen.getByText("99+")).toBeDefined();
  });
});

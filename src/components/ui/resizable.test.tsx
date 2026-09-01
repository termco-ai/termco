// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ?? (ResizeObserverStub as never);
});

afterEach(cleanup);

describe("Resizable", () => {
  it("renders a panel group with panels and a handle", () => {
    const { container } = render(
      <ResizablePanelGroup className="border">
        <ResizablePanel>left pane</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>right pane</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const group = container.querySelector(
      "[data-slot=resizable-panel-group]",
    ) as HTMLElement;
    expect(group.className).toContain("border");
    expect(screen.getByText("left pane")).toBeInTheDocument();
    expect(screen.getByText("right pane")).toBeInTheDocument();
    expect(
      container.querySelector("[data-slot=resizable-handle]"),
    ).not.toBeNull();
  });

  it("renders the grip element only with withHandle", () => {
    const { container, rerender } = render(
      <ResizablePanelGroup>
        <ResizablePanel>a</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>b</ResizablePanel>
      </ResizablePanelGroup>,
    );
    let handle = container.querySelector(
      "[data-slot=resizable-handle]",
    ) as HTMLElement;
    expect(handle.querySelector("div")).not.toBeNull();

    rerender(
      <ResizablePanelGroup>
        <ResizablePanel>a</ResizablePanel>
        <ResizableHandle />
        <ResizablePanel>b</ResizablePanel>
      </ResizablePanelGroup>,
    );
    handle = container.querySelector(
      "[data-slot=resizable-handle]",
    ) as HTMLElement;
    expect(handle.querySelector("div")).toBeNull();
  });

  it("supports vertical orientation", () => {
    const { container } = render(
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel>a</ResizablePanel>
      </ResizablePanelGroup>,
    );
    const group = container.querySelector(
      "[data-slot=resizable-panel-group]",
    ) as HTMLElement;
    expect(group.style.flexDirection).toBe("column");
  });
});

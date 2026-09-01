// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ScrollArea, ScrollBar } from "./scroll-area";

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

describe("ScrollArea", () => {
  it("renders children inside the viewport", () => {
    const { container } = render(
      <ScrollArea className="h-40">
        <p>scrollable content</p>
      </ScrollArea>,
    );
    const root = container.querySelector("[data-slot=scroll-area]");
    expect(root).not.toBeNull();
    expect((root as HTMLElement).className).toContain("h-40");
    const viewport = container.querySelector(
      "[data-slot=scroll-area-viewport]",
    );
    expect(viewport).not.toBeNull();
    expect(screen.getByText("scrollable content")).toBeInTheDocument();
  });

  it("renders an explicit horizontal scrollbar", () => {
    const { container } = render(
      <ScrollArea>
        <ScrollBar orientation="horizontal" />
        content
      </ScrollArea>,
    );
    expect(
      container.querySelector("[data-slot=scroll-area]"),
    ).not.toBeNull();
  });
});

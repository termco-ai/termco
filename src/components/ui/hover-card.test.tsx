// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";

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

describe("HoverCard", () => {
  it("renders the trigger without content when closed", () => {
    render(
      <HoverCard>
        <HoverCardTrigger>trigger</HoverCardTrigger>
        <HoverCardContent>card body</HoverCardContent>
      </HoverCard>,
    );
    expect(screen.getByText("trigger")).toHaveAttribute(
      "data-slot",
      "hover-card-trigger",
    );
    expect(screen.queryByText("card body")).not.toBeInTheDocument();
  });

  it("portals the content when open and merges classes", () => {
    render(
      <HoverCard open>
        <HoverCardTrigger>trigger</HoverCardTrigger>
        <HoverCardContent className="w-40">card body</HoverCardContent>
      </HoverCard>,
    );
    const content = screen.getByText("card body");
    expect(content).toHaveAttribute("data-slot", "hover-card-content");
    expect(content.className).toContain("w-40");
    expect(content.className).not.toContain("w-72");
  });
});

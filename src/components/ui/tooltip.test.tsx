// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

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

describe("Tooltip", () => {
  it("renders the trigger without content when closed", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>hover me</TooltipTrigger>
          <TooltipContent>tip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const trigger = screen.getByText("hover me");
    expect(trigger).toHaveAttribute("data-slot", "tooltip-trigger");
    expect(screen.queryByText("tip body")).not.toBeInTheDocument();
  });

  it("shows the content when open", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>hover me</TooltipTrigger>
          <TooltipContent className="extra">tip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const contents = screen.getAllByText("tip body");
    expect(contents.length).toBeGreaterThan(0);
    const slotted = contents.find(
      (el) => el.getAttribute("data-slot") === "tooltip-content",
    );
    expect(slotted).toBeDefined();
    expect(slotted?.className).toContain("extra");
  });
});

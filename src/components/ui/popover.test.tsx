// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";

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

describe("Popover", () => {
  it("opens the content when the trigger is clicked", () => {
    render(
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>popover body</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText("popover body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("open"));
    const content = screen.getByText("popover body");
    expect(content).toHaveAttribute("data-slot", "popover-content");
  });

  it("renders header, title, description and anchor", () => {
    render(
      <Popover open>
        <PopoverAnchor>
          <span>anchor</span>
        </PopoverAnchor>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Title</PopoverTitle>
            <PopoverDescription>Description</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.getByText("anchor")).toBeInTheDocument();
    expect(screen.getByText("Title")).toHaveAttribute(
      "data-slot",
      "popover-title",
    );
    expect(screen.getByText("Description")).toHaveAttribute(
      "data-slot",
      "popover-description",
    );
    expect(screen.getByText("Title").parentElement).toHaveAttribute(
      "data-slot",
      "popover-header",
    );
  });
});

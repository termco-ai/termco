// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

afterEach(cleanup);

describe("ToggleGroup", () => {
  it("selects a single item on click", () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup type="single" onValueChange={onValueChange}>
        <ToggleGroupItem value="left">L</ToggleGroupItem>
        <ToggleGroupItem value="right">R</ToggleGroupItem>
      </ToggleGroup>,
    );
    fireEvent.click(screen.getByText("R"));
    expect(onValueChange).toHaveBeenCalledWith("right");
    expect(screen.getByText("R")).toHaveAttribute("data-state", "on");
    expect(screen.getByText("L")).toHaveAttribute("data-state", "off");
  });

  it("propagates variant, size and spacing to items via context", () => {
    render(
      <ToggleGroup type="single" variant="outline" size="sm" spacing={2}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    const group = document.querySelector(
      "[data-slot=toggle-group]",
    ) as HTMLElement;
    expect(group).toHaveAttribute("data-variant", "outline");
    expect(group).toHaveAttribute("data-spacing", "2");
    const item = screen.getByText("A");
    expect(item).toHaveAttribute("data-variant", "outline");
    expect(item).toHaveAttribute("data-size", "sm");
    expect(item).toHaveAttribute("data-spacing", "2");
    expect(item.className).toContain("border-input");
  });

  it("falls back to item-level variant when the group sets none", () => {
    render(
      <ToggleGroup type="single">
        <ToggleGroupItem value="a" variant="outline" size="lg">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    );
    const item = screen.getByText("A");
    expect(item).toHaveAttribute("data-variant", "outline");
    expect(item).toHaveAttribute("data-size", "lg");
  });

  it("supports vertical orientation", () => {
    render(
      <ToggleGroup type="multiple" orientation="vertical">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(
      document.querySelector("[data-slot=toggle-group]"),
    ).toHaveAttribute("data-orientation", "vertical");
  });
});

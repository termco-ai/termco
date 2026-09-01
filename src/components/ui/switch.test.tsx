// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

afterEach(cleanup);

describe("Switch", () => {
  it("toggles between unchecked and checked", () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange} />);
    const el = screen.getByRole("switch");
    expect(el).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(el);
    expect(el).toHaveAttribute("data-state", "checked");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("defaults to the default size and supports sm", () => {
    const { rerender } = render(<Switch />);
    expect(screen.getByRole("switch")).toHaveAttribute("data-size", "default");
    rerender(<Switch size="sm" />);
    expect(screen.getByRole("switch")).toHaveAttribute("data-size", "sm");
  });

  it("does not toggle when disabled", () => {
    render(<Switch disabled />);
    const el = screen.getByRole("switch");
    fireEvent.click(el);
    expect(el).toHaveAttribute("data-state", "unchecked");
  });

  it("renders the thumb and merges custom classes", () => {
    const { container } = render(<Switch className="mx-2" />);
    expect(screen.getByRole("switch").className).toContain("mx-2");
    expect(
      container.querySelector("[data-slot=switch-thumb]"),
    ).not.toBeNull();
  });
});

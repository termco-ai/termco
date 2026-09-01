// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("toggles the checked state on click", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox onCheckedChange={onCheckedChange} />);
    const el = screen.getByRole("checkbox");
    expect(el).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(el);
    expect(el).toHaveAttribute("data-state", "checked");
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("shows the indicator only when checked", () => {
    const { container } = render(<Checkbox defaultChecked />);
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "data-state",
      "checked",
    );
    expect(
      container.querySelector("[data-slot=checkbox-indicator]"),
    ).not.toBeNull();
  });

  it("supports the indeterminate state", () => {
    render(<Checkbox checked="indeterminate" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute(
      "data-state",
      "indeterminate",
    );
  });

  it("ignores clicks when disabled", () => {
    render(<Checkbox disabled />);
    const el = screen.getByRole("checkbox");
    fireEvent.click(el);
    expect(el).toHaveAttribute("data-state", "unchecked");
  });
});

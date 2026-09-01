// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toggle, toggleVariants } from "./toggle";

afterEach(cleanup);

describe("Toggle", () => {
  it("toggles aria-pressed on click", () => {
    const onPressedChange = vi.fn();
    render(<Toggle onPressedChange={onPressedChange}>bold</Toggle>);
    const el = screen.getByRole("button");
    expect(el).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(el);
    expect(el).toHaveAttribute("aria-pressed", "true");
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it("applies the outline variant and sizes", () => {
    const { rerender } = render(<Toggle variant="outline">x</Toggle>);
    expect(screen.getByRole("button").className).toContain("border-input");
    rerender(<Toggle size="sm">x</Toggle>);
    expect(screen.getByRole("button").className).toContain("h-8");
    rerender(<Toggle size="lg">x</Toggle>);
    expect(screen.getByRole("button").className).toContain("h-10");
  });

  it("honors defaultPressed and disabled", () => {
    render(
      <Toggle defaultPressed disabled>
        x
      </Toggle>,
    );
    const el = screen.getByRole("button");
    expect(el).toHaveAttribute("aria-pressed", "true");
    expect(el).toBeDisabled();
  });

  it("exposes toggleVariants", () => {
    expect(toggleVariants({ size: "lg" })).toContain("h-10");
  });
});

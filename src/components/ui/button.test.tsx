// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, buttonVariants } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders a button with default variant and size", () => {
    render(<Button>Save</Button>);
    const el = screen.getByRole("button", { name: "Save" });
    expect(el).toHaveAttribute("data-slot", "button");
    expect(el).toHaveAttribute("data-variant", "default");
    expect(el).toHaveAttribute("data-size", "default");
    expect(el.className).toContain("bg-primary");
  });

  it.each([
    ["outline", "border-border"],
    ["secondary", "bg-secondary"],
    ["ghost", "hover:bg-accent"],
    ["destructive", "text-destructive"],
    ["link", "underline-offset-4"],
  ] as const)("applies the %s variant", (variant, expectedClass) => {
    render(<Button variant={variant}>v</Button>);
    const el = screen.getByRole("button");
    expect(el).toHaveAttribute("data-variant", variant);
    expect(el.className).toContain(expectedClass);
  });

  it.each([
    ["xs", "h-6"],
    ["sm", "h-7"],
    ["lg", "h-9"],
    ["icon", "size-8"],
    ["icon-xs", "size-6"],
    ["icon-sm", "size-7"],
    ["icon-lg", "size-9"],
  ] as const)("applies the %s size", (size, expectedClass) => {
    render(<Button size={size}>s</Button>);
    const el = screen.getByRole("button");
    expect(el).toHaveAttribute("data-size", size);
    expect(el.className).toContain(expectedClass);
  });

  it("fires click handlers and honors disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Off
      </Button>,
    );
    const el = screen.getByRole("button");
    expect(el).toBeDisabled();
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders its child element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/target">Go</a>
      </Button>,
    );
    const el = screen.getByText("Go");
    expect(el.tagName).toBe("A");
    expect(el).toHaveAttribute("data-slot", "button");
  });

  it("exposes buttonVariants for external composition", () => {
    expect(buttonVariants({ variant: "ghost", size: "sm" })).toContain("h-7");
  });
});

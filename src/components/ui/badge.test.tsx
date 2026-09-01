// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge, badgeVariants } from "./badge";

afterEach(cleanup);

describe("Badge", () => {
  it("renders a span with the default variant", () => {
    render(<Badge>New</Badge>);
    const el = screen.getByText("New");
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("data-slot", "badge");
    expect(el).toHaveAttribute("data-variant", "default");
    expect(el.className).toContain("bg-primary");
  });

  it.each([
    ["secondary", "bg-secondary"],
    ["destructive", "text-destructive"],
    ["outline", "border-border"],
    ["ghost", "hover:bg-muted"],
    ["link", "underline-offset-4"],
  ] as const)("applies the %s variant", (variant, expectedClass) => {
    render(<Badge variant={variant}>v</Badge>);
    const el = screen.getByText("v");
    expect(el).toHaveAttribute("data-variant", variant);
    expect(el.className).toContain(expectedClass);
  });

  it("renders its child element when asChild is set", () => {
    render(
      <Badge asChild>
        <a href="/x">link badge</a>
      </Badge>,
    );
    const el = screen.getByText("link badge");
    expect(el.tagName).toBe("A");
    expect(el).toHaveAttribute("data-slot", "badge");
  });

  it("exposes badgeVariants for external composition", () => {
    expect(badgeVariants({ variant: "secondary" })).toContain("bg-secondary");
  });
});

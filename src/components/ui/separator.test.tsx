// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Separator } from "./separator";

afterEach(cleanup);

describe("Separator", () => {
  it("is horizontal and decorative by default", () => {
    const { container } = render(<Separator />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("data-slot", "separator");
    expect(el).toHaveAttribute("data-orientation", "horizontal");
    expect(el).toHaveAttribute("role", "none");
  });

  it("supports vertical orientation", () => {
    const { container } = render(<Separator orientation="vertical" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("data-orientation", "vertical");
  });

  it("exposes a semantic separator when not decorative", () => {
    const { container } = render(<Separator decorative={false} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("role", "separator");
  });

  it("merges custom classes", () => {
    const { container } = render(<Separator className="bg-red-500" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("bg-red-500");
    expect(el.className).not.toContain("bg-border");
  });
});

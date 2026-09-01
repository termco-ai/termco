// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("renders a pulsing div with the skeleton slot", () => {
    const { container } = render(<Skeleton data-testid="s" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("data-slot", "skeleton");
    expect(el.className).toContain("animate-pulse");
  });

  it("merges custom classes over the defaults", () => {
    const { container } = render(<Skeleton className="rounded-none h-4" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("rounded-none");
    expect(el.className).not.toContain("rounded-2xl");
    expect(el.className).toContain("h-4");
  });
});

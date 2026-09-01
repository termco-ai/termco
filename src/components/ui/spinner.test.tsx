// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Spinner } from "./spinner";

afterEach(cleanup);

describe("Spinner", () => {
  it("renders an accessible loading indicator", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-label", "Loading");
    expect(el.getAttribute("class")).toContain("animate-spin");
  });

  it("merges custom classes over the default size", () => {
    render(<Spinner className="size-8" />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("class")).toContain("size-8");
    expect(el.getAttribute("class")).not.toContain("size-4");
  });
});

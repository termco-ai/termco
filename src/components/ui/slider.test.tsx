// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Slider } from "./slider";

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

describe("Slider", () => {
  it("renders one thumb per default value", () => {
    render(<Slider defaultValue={[20, 80]} />);
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute("aria-valuenow", "20");
    expect(thumbs[1]).toHaveAttribute("aria-valuenow", "80");
  });

  it("renders a single controlled thumb", () => {
    render(<Slider value={[35]} />);
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveAttribute("aria-valuenow", "35");
  });

  it("still renders a usable thumb without a value", () => {
    render(<Slider min={0} max={10} />);
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs.length).toBeGreaterThan(0);
    expect(thumbs[0]).toHaveAttribute("aria-valuemin", "0");
    expect(thumbs[0]).toHaveAttribute("aria-valuemax", "10");
  });

  it("exposes slot attributes and merges classes", () => {
    const { container } = render(
      <Slider defaultValue={[1]} className="w-40" />,
    );
    const root = container.querySelector("[data-slot=slider]") as HTMLElement;
    expect(root.className).toContain("w-40");
    expect(container.querySelector("[data-slot=slider-track]")).not.toBeNull();
    expect(container.querySelector("[data-slot=slider-range]")).not.toBeNull();
  });
});

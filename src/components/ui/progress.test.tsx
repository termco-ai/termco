// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Progress } from "./progress";

function indicator(container: HTMLElement): HTMLElement {
  return container.querySelector(
    "[data-slot=progress-indicator]",
  ) as HTMLElement;
}

afterEach(cleanup);

describe("Progress", () => {
  it("renders a progressbar with the value translated into the track", () => {
    const { container, getByRole } = render(<Progress value={30} />);
    expect(getByRole("progressbar")).toHaveAttribute("data-slot", "progress");
    expect(indicator(container).style.transform).toBe("translateX(-70%)");
  });

  it("treats a missing value as zero progress", () => {
    const { container } = render(<Progress />);
    expect(indicator(container).style.transform).toBe("translateX(-100%)");
  });

  it("fills completely at 100", () => {
    const { container } = render(<Progress value={100} className="h-1" />);
    expect(indicator(container).style.transform).toBe("translateX(-0%)");
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("h-1");
  });
});

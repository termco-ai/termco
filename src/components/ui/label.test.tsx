// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Label } from "./label";

afterEach(cleanup);

describe("Label", () => {
  it("renders a label element associated with a control", () => {
    render(
      <>
        <Label htmlFor="field">Name</Label>
        <input id="field" />
      </>,
    );
    const label = screen.getByText("Name");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("data-slot", "label");
    expect(label).toHaveAttribute("for", "field");
  });

  it("merges custom classes", () => {
    render(<Label className="text-lg">Big</Label>);
    const label = screen.getByText("Big");
    expect(label.className).toContain("text-lg");
    expect(label.className).not.toContain("text-sm");
  });
});

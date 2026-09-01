// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RadioGroup, RadioGroupItem } from "./radio-group";

afterEach(cleanup);

describe("RadioGroup", () => {
  it("selects an item on click and reports the value", () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup onValueChange={onValueChange}>
        <RadioGroupItem value="a" aria-label="option a" />
        <RadioGroupItem value="b" aria-label="option b" />
      </RadioGroup>,
    );
    const b = screen.getByLabelText("option b");
    fireEvent.click(b);
    expect(onValueChange).toHaveBeenCalledWith("b");
    expect(b).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText("option a")).toHaveAttribute(
      "data-state",
      "unchecked",
    );
  });

  it("honors a default value", () => {
    render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" aria-label="option a" />
        <RadioGroupItem value="b" aria-label="option b" />
      </RadioGroup>,
    );
    expect(screen.getByLabelText("option a")).toHaveAttribute(
      "data-state",
      "checked",
    );
  });

  it("exposes slot attributes and merges classes", () => {
    render(
      <RadioGroup className="gap-1">
        <RadioGroupItem value="a" aria-label="option a" className="size-6" />
      </RadioGroup>,
    );
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("data-slot", "radio-group");
    expect(group.className).toContain("gap-1");
    const item = screen.getByLabelText("option a");
    expect(item).toHaveAttribute("data-slot", "radio-group-item");
    expect(item.className).toContain("size-6");
  });
});

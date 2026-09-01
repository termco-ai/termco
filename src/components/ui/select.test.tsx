// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ?? (ResizeObserverStub as never);
  Element.prototype.hasPointerCapture =
    Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture =
    Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture =
    Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView =
    Element.prototype.scrollIntoView ?? (() => {});
});

afterEach(cleanup);

describe("Select", () => {
  it("renders the trigger with the selected value", () => {
    render(
      <Select defaultValue="b">
        <SelectTrigger aria-label="pick">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
          <SelectItem value="b">Beta</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByLabelText("pick");
    expect(trigger).toHaveAttribute("data-slot", "select-trigger");
    expect(trigger).toHaveAttribute("data-size", "default");
    expect(trigger).toHaveTextContent("Beta");
  });

  it("supports the sm trigger size", () => {
    render(
      <Select>
        <SelectTrigger size="sm" aria-label="pick">
          <SelectValue placeholder="choose" />
        </SelectTrigger>
      </Select>,
    );
    expect(screen.getByLabelText("pick")).toHaveAttribute("data-size", "sm");
    expect(screen.getByText("choose")).toBeInTheDocument();
  });

  it("renders groups, labels, items and separators when open", () => {
    render(
      <Select open defaultValue="a">
        <SelectTrigger aria-label="pick">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Group label</SelectLabel>
            <SelectItem value="a">Alpha</SelectItem>
            <SelectSeparator />
            <SelectItem value="b">Beta</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByText("Group label")).toHaveAttribute(
      "data-slot",
      "select-label",
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("data-slot", "select-item");
    expect(options[0]).toHaveAttribute("data-state", "checked");
    expect(options[1]).toHaveAttribute("data-state", "unchecked");
    expect(
      document.querySelector("[data-slot=select-separator]"),
    ).not.toBeNull();
  });
});

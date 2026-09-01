// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group";

afterEach(cleanup);

describe("InputGroup", () => {
  it("renders a group with an embedded input control", () => {
    render(
      <InputGroup className="w-64">
        <InputGroupInput aria-label="query" />
      </InputGroup>,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("data-slot", "input-group");
    expect(group.className).toContain("w-64");
    expect(screen.getByLabelText("query")).toHaveAttribute(
      "data-slot",
      "input-group-control",
    );
  });

  it("focuses the input when the addon is clicked", () => {
    render(
      <InputGroup>
        <InputGroupInput aria-label="query" />
        <InputGroupAddon>
          <InputGroupText>@</InputGroupText>
        </InputGroupAddon>
      </InputGroup>,
    );
    fireEvent.click(screen.getByText("@"));
    expect(screen.getByLabelText("query")).toHaveFocus();
  });

  it("does not steal focus when a button inside the addon is clicked", () => {
    const onClick = vi.fn();
    render(
      <InputGroup>
        <InputGroupInput aria-label="query" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton onClick={onClick}>go</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    fireEvent.click(screen.getByText("go"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("query")).not.toHaveFocus();
  });

  it("applies addon alignment variants", () => {
    render(
      <InputGroupAddon align="block-end" data-testid="addon">
        x
      </InputGroupAddon>,
    );
    const addon = screen.getByTestId("addon");
    expect(addon).toHaveAttribute("data-align", "block-end");
    expect(addon.className).toContain("order-last");
  });

  it("applies button sizes with ghost defaults", () => {
    render(<InputGroupButton size="icon-sm">b</InputGroupButton>);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("data-size", "icon-sm");
    expect(button).toHaveAttribute("data-variant", "ghost");
    expect(button).toHaveAttribute("type", "button");
  });

  it("renders a textarea control variant", () => {
    render(<InputGroupTextarea aria-label="body" />);
    const el = screen.getByLabelText("body");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveAttribute("data-slot", "input-group-control");
  });
});

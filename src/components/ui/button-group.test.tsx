// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
} from "./button-group";

afterEach(cleanup);

describe("ButtonGroup", () => {
  it("renders a group with horizontal defaults", () => {
    render(<ButtonGroup>content</ButtonGroup>);
    const el = screen.getByRole("group");
    expect(el).toHaveAttribute("data-slot", "button-group");
    expect(el.className).toContain("flex");
  });

  it("supports vertical orientation", () => {
    render(<ButtonGroup orientation="vertical">content</ButtonGroup>);
    const el = screen.getByRole("group");
    expect(el).toHaveAttribute("data-orientation", "vertical");
    expect(el.className).toContain("flex-col");
  });

  it("exposes buttonGroupVariants", () => {
    expect(buttonGroupVariants({ orientation: "vertical" })).toContain(
      "flex-col",
    );
  });
});

describe("ButtonGroupText", () => {
  it("renders a div by default", () => {
    render(<ButtonGroupText>text</ButtonGroupText>);
    expect(screen.getByText("text").tagName).toBe("DIV");
  });

  it("renders its child when asChild is set", () => {
    render(
      <ButtonGroupText asChild>
        <span>inner</span>
      </ButtonGroupText>,
    );
    const el = screen.getByText("inner");
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("bg-muted");
  });
});

describe("ButtonGroupSeparator", () => {
  it("defaults to a vertical separator", () => {
    const { container } = render(<ButtonGroupSeparator />);
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute("data-slot", "button-group-separator");
    expect(el).toHaveAttribute("data-orientation", "vertical");
  });
});

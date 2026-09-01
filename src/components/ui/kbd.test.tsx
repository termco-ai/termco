// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Kbd, KbdGroup } from "./kbd";

afterEach(cleanup);

describe("Kbd", () => {
  it("renders a kbd element with the slot attribute", () => {
    render(<Kbd>K</Kbd>);
    const el = screen.getByText("K");
    expect(el.tagName).toBe("KBD");
    expect(el).toHaveAttribute("data-slot", "kbd");
  });

  it("merges custom classes", () => {
    render(<Kbd className="text-base">Esc</Kbd>);
    expect(screen.getByText("Esc").className).toContain("text-base");
  });
});

describe("KbdGroup", () => {
  it("groups keys with the kbd-group slot", () => {
    render(
      <KbdGroup className="gap-2">
        <Kbd>Ctrl</Kbd>
        <Kbd>C</Kbd>
      </KbdGroup>,
    );
    const group = screen.getByText("Ctrl").parentElement as HTMLElement;
    expect(group).toHaveAttribute("data-slot", "kbd-group");
    expect(group.className).toContain("gap-2");
  });
});

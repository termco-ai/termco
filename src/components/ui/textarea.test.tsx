// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Textarea } from "./textarea";

afterEach(cleanup);

describe("Textarea", () => {
  it("renders a textarea with the slot attribute", () => {
    render(<Textarea placeholder="type here" />);
    const el = screen.getByPlaceholderText("type here");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveAttribute("data-slot", "textarea");
  });

  it("merges custom classes and forwards props", () => {
    const onChange = vi.fn();
    render(
      <Textarea
        aria-label="notes"
        className="min-h-32"
        disabled
        onChange={onChange}
      />,
    );
    const el = screen.getByLabelText("notes");
    expect(el.className).toContain("min-h-32");
    expect(el.className).not.toContain("min-h-16");
    expect(el).toBeDisabled();
  });

  it("accepts user input", () => {
    render(<Textarea aria-label="notes" />);
    const el = screen.getByLabelText("notes") as HTMLTextAreaElement;
    fireEvent.change(el, { target: { value: "hello" } });
    expect(el.value).toBe("hello");
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input } from "./input";

afterEach(cleanup);

describe("Input", () => {
  it("renders an input with the slot attribute and type", () => {
    render(<Input type="password" aria-label="secret" />);
    const el = screen.getByLabelText("secret");
    expect(el).toHaveAttribute("data-slot", "input");
    expect(el).toHaveAttribute("type", "password");
  });

  it("merges custom classes over the defaults", () => {
    render(<Input aria-label="name" className="h-12" />);
    const el = screen.getByLabelText("name");
    expect(el.className).toContain("h-12");
    expect(el.className).not.toContain("h-9");
  });

  it("accepts user input and disabled state", () => {
    render(<Input aria-label="name" disabled />);
    expect(screen.getByLabelText("name")).toBeDisabled();
    cleanup();
    render(<Input aria-label="name" />);
    const el = screen.getByLabelText("name") as HTMLInputElement;
    fireEvent.change(el, { target: { value: "termco" } });
    expect(el.value).toBe("termco");
  });
});

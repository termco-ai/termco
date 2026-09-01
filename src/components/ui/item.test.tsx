// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "./item";

afterEach(cleanup);

describe("Item", () => {
  it("renders the full item composition with slot attributes", () => {
    render(
      <ItemGroup>
        <Item>
          <ItemHeader>header</ItemHeader>
          <ItemMedia>media</ItemMedia>
          <ItemContent>
            <ItemTitle>Title</ItemTitle>
            <ItemDescription>Description</ItemDescription>
          </ItemContent>
          <ItemActions>actions</ItemActions>
          <ItemFooter>footer</ItemFooter>
        </Item>
        <ItemSeparator />
      </ItemGroup>,
    );
    expect(screen.getByRole("list")).toHaveAttribute(
      "data-slot",
      "item-group",
    );
    expect(screen.getByText("Title")).toHaveAttribute("data-slot", "item-title");
    expect(screen.getByText("Description")).toHaveAttribute(
      "data-slot",
      "item-description",
    );
    expect(screen.getByText("header")).toHaveAttribute(
      "data-slot",
      "item-header",
    );
    expect(screen.getByText("footer")).toHaveAttribute(
      "data-slot",
      "item-footer",
    );
    expect(screen.getByText("actions")).toHaveAttribute(
      "data-slot",
      "item-actions",
    );
  });

  it.each([
    ["outline", "border-border"],
    ["muted", "bg-muted/50"],
  ] as const)("applies the %s variant", (variant, expectedClass) => {
    render(<Item variant={variant}>v</Item>);
    const el = screen.getByText("v");
    expect(el).toHaveAttribute("data-variant", variant);
    expect(el.className).toContain(expectedClass);
  });

  it.each([
    ["sm", "py-3"],
    ["xs", "py-2.5"],
  ] as const)("applies the %s size", (size, expectedClass) => {
    render(<Item size={size}>s</Item>);
    const el = screen.getByText("s");
    expect(el).toHaveAttribute("data-size", size);
    expect(el.className).toContain(expectedClass);
  });

  it("renders its child element when asChild is set", () => {
    render(
      <Item asChild>
        <a href="/x">link item</a>
      </Item>,
    );
    const el = screen.getByText("link item");
    expect(el.tagName).toBe("A");
    expect(el).toHaveAttribute("data-slot", "item");
  });

  it("applies media variants", () => {
    render(<ItemMedia variant="icon">i</ItemMedia>);
    const el = screen.getByText("i");
    expect(el).toHaveAttribute("data-variant", "icon");
  });
});

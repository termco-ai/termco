// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

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
  Element.prototype.releasePointerCapture =
    Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView =
    Element.prototype.scrollIntoView ?? (() => {});
});

afterEach(cleanup);

describe("DropdownMenu", () => {
  it("renders a closed trigger without content", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item one</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("menu")).toHaveAttribute(
      "data-slot",
      "dropdown-menu-trigger",
    );
    expect(screen.queryByText("Item one")).not.toBeInTheDocument();
  });

  it("renders items, labels, separators and shortcuts when open", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel inset>Section</DropdownMenuLabel>
            <DropdownMenuItem>
              Item one
              <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Section")).toHaveAttribute("data-inset", "true");
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Delete")).toHaveAttribute(
      "data-variant",
      "destructive",
    );
    expect(screen.getByText("⌘1")).toHaveAttribute(
      "data-slot",
      "dropdown-menu-shortcut",
    );
    expect(
      document.querySelector("[data-slot=dropdown-menu-separator]"),
    ).not.toBeNull();
  });

  it("fires onSelect when an item is clicked", () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Pick me</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    fireEvent.click(screen.getByText("Pick me"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("toggles checkbox items", () => {
    const onCheckedChange = vi.fn();
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked
            onCheckedChange={onCheckedChange}
          >
            Enabled
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemcheckbox");
    expect(item).toHaveAttribute("data-state", "checked");
    fireEvent.click(item);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("selects radio items within a group", () => {
    const onValueChange = vi.fn();
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a" onValueChange={onValueChange}>
            <DropdownMenuRadioItem value="a">A</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">B</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios[0]).toHaveAttribute("data-state", "checked");
    expect(radios[1]).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(radios[1] as HTMLElement);
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("renders a sub-menu trigger with its arrow icon", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>More tools</DropdownMenuSubTrigger>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const sub = screen.getByText("More tools");
    expect(sub).toHaveAttribute("data-slot", "dropdown-menu-sub-trigger");
    expect(sub).toHaveAttribute("data-inset", "true");
    expect(sub.querySelector("svg")).not.toBeNull();
  });
});

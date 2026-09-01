// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu";

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

function openMenu() {
  fireEvent.contextMenu(screen.getByText("target"));
}

describe("ContextMenu", () => {
  it("opens on right click and renders the item set", () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuLabel inset>Actions</ContextMenuLabel>
            <ContextMenuItem onSelect={onSelect}>
              Rename
              <ContextMenuShortcut>F2</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive">Delete</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByText("Actions")).toHaveAttribute("data-inset", "true");
    expect(screen.getByText("F2")).toHaveAttribute(
      "data-slot",
      "context-menu-shortcut",
    );
    expect(screen.getByText("Delete")).toHaveAttribute(
      "data-variant",
      "destructive",
    );
    fireEvent.click(screen.getByText("Rename"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("supports checkbox and radio items", () => {
    const onCheckedChange = vi.fn();
    const onValueChange = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked
            onCheckedChange={onCheckedChange}
          >
            Show hidden
          </ContextMenuCheckboxItem>
          <ContextMenuRadioGroup value="name" onValueChange={onValueChange}>
            <ContextMenuRadioItem value="name">By name</ContextMenuRadioItem>
            <ContextMenuRadioItem value="date">By date</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>,
    );
    openMenu();
    const checkbox = screen.getByRole("menuitemcheckbox");
    expect(checkbox).toHaveAttribute("data-state", "checked");
    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(false);

    openMenu();
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios[0]).toHaveAttribute("data-state", "checked");
    fireEvent.click(radios[1] as HTMLElement);
    expect(onValueChange).toHaveBeenCalledWith("date");
  });

  it("renders a sub-menu trigger with the arrow icon", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger inset>Open with</ContextMenuSubTrigger>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    );
    openMenu();
    const sub = screen.getByText("Open with");
    expect(sub).toHaveAttribute("data-slot", "context-menu-sub-trigger");
    expect(sub).toHaveAttribute("data-inset", "true");
    expect(sub.querySelector("svg")).not.toBeNull();
  });
});

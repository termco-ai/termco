// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubTrigger,
  MenubarTrigger,
} from "./menubar";

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

function renderMenubar(open = true) {
  return render(
    <Menubar value={open ? "file" : undefined}>
      <MenubarMenu value="file">
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarGroup>
            <MenubarLabel inset>File actions</MenubarLabel>
            <MenubarItem>
              New tab
              <MenubarShortcut>⌘T</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem variant="destructive">Close window</MenubarItem>
          </MenubarGroup>
          <MenubarCheckboxItem checked>Word wrap</MenubarCheckboxItem>
          <MenubarRadioGroup value="dark">
            <MenubarRadioItem value="light">Light</MenubarRadioItem>
            <MenubarRadioItem value="dark">Dark</MenubarRadioItem>
          </MenubarRadioGroup>
          <MenubarSub>
            <MenubarSubTrigger inset>Share</MenubarSubTrigger>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>,
  );
}

describe("Menubar", () => {
  it("renders the bar with a closed menu by default", () => {
    renderMenubar(false);
    expect(screen.getByRole("menubar")).toHaveAttribute(
      "data-slot",
      "menubar",
    );
    expect(screen.getByText("File")).toHaveAttribute(
      "data-slot",
      "menubar-trigger",
    );
    expect(screen.queryByText("New tab")).not.toBeInTheDocument();
  });

  it("renders items, separators, shortcuts and variants when open", () => {
    renderMenubar();
    expect(screen.getByText("File actions")).toHaveAttribute(
      "data-inset",
      "true",
    );
    expect(screen.getByText("⌘T")).toHaveAttribute(
      "data-slot",
      "menubar-shortcut",
    );
    expect(screen.getByText("Close window")).toHaveAttribute(
      "data-variant",
      "destructive",
    );
    expect(
      document.querySelector("[data-slot=menubar-separator]"),
    ).not.toBeNull();
  });

  it("marks checkbox and radio state", () => {
    renderMenubar();
    expect(screen.getByRole("menuitemcheckbox")).toHaveAttribute(
      "data-state",
      "checked",
    );
    const radios = screen.getAllByRole("menuitemradio");
    expect(radios[0]).toHaveAttribute("data-state", "unchecked");
    expect(radios[1]).toHaveAttribute("data-state", "checked");
  });

  it("renders the sub-menu trigger with an arrow icon", () => {
    renderMenubar();
    const sub = screen.getByText("Share");
    expect(sub).toHaveAttribute("data-slot", "menubar-sub-trigger");
    expect(sub.querySelector("svg")).not.toBeNull();
  });

  it("fires onSelect for menu items", () => {
    const onSelect = vi.fn();
    render(
      <Menubar value="m">
        <MenubarMenu value="m">
          <MenubarTrigger>Menu</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onSelect}>Do it</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );
    fireEvent.click(screen.getByText("Do it"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ?? (ResizeObserverStub as never);
  Element.prototype.scrollIntoView =
    Element.prototype.scrollIntoView ?? (() => {});
});

afterEach(cleanup);

function renderPalette() {
  return render(
    <Command>
      <CommandInput placeholder="search" />
      <CommandList>
        <CommandEmpty>nothing found</CommandEmpty>
        <CommandGroup heading="Files">
          <CommandItem>Open file</CommandItem>
          <CommandItem>
            Save file
            <CommandShortcut>⌘S</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
      </CommandList>
    </Command>,
  );
}

describe("Command", () => {
  it("renders items grouped under headings", () => {
    renderPalette();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Open file")).toBeInTheDocument();
    expect(screen.getByText("⌘S")).toHaveAttribute(
      "data-slot",
      "command-shortcut",
    );
    expect(screen.queryByText("nothing found")).not.toBeInTheDocument();
  });

  it("filters items from the search input", () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("search"), {
      target: { value: "save" },
    });
    expect(screen.getByText("Save file")).toBeInTheDocument();
    expect(screen.queryByText("Open file")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText("search"), {
      target: { value: "zzzzz" },
    });
    expect(screen.getByText("nothing found")).toBeInTheDocument();
  });
});

describe("CommandDialog", () => {
  it("wraps the palette in an accessible dialog", () => {
    render(
      <CommandDialog open title="Palette" description="Run something">
        <Command>
          <CommandList>
            <CommandItem>Only item</CommandItem>
          </CommandList>
        </Command>
      </CommandDialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Only item")).toBeInTheDocument();
  });
});

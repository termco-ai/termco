// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

afterEach(cleanup);

describe("Sheet", () => {
  it("opens via the trigger and renders the right side by default", () => {
    render(
      <Sheet>
        <SheetTrigger>open sheet</SheetTrigger>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.queryByText("Sheet title")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("open sheet"));
    const content = document.querySelector(
      "[data-slot=sheet-content]",
    ) as HTMLElement;
    expect(content).toHaveAttribute("data-side", "right");
    expect(screen.getByText("Sheet title")).toHaveAttribute(
      "data-slot",
      "sheet-title",
    );
    expect(screen.getByText("Sheet description")).toHaveAttribute(
      "data-slot",
      "sheet-description",
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
  });

  it("supports other sides and hiding the close button", () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="left" showCloseButton={false}>
          <SheetHeader>
            <SheetTitle>t</SheetTitle>
            <SheetDescription>d</SheetDescription>
          </SheetHeader>
          <SheetFooter>footer</SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    const content = document.querySelector(
      "[data-slot=sheet-content]",
    ) as HTMLElement;
    expect(content).toHaveAttribute("data-side", "left");
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
    expect(screen.getByText("footer")).toHaveAttribute(
      "data-slot",
      "sheet-footer",
    );
  });

  it("closes from a SheetClose element", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet defaultOpen onOpenChange={onOpenChange}>
        <SheetContent showCloseButton={false}>
          <SheetTitle>t</SheetTitle>
          <SheetDescription>d</SheetDescription>
          <SheetClose>Dismiss</SheetClose>
        </SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("t")).not.toBeInTheDocument();
  });
});

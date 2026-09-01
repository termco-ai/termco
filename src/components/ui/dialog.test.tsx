// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

afterEach(cleanup);

function renderDialog(props?: { showCloseButton?: boolean }) {
  return render(
    <Dialog defaultOpen>
      <DialogContent showCloseButton={props?.showCloseButton}>
        <DialogHeader>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <DialogClose>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );
}

describe("Dialog", () => {
  it("opens via the trigger", () => {
    render(
      <Dialog>
        <DialogTrigger>open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>Inner</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText("Inner")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("open dialog"));
    expect(screen.getByText("Inner")).toBeInTheDocument();
  });

  it("renders title, description and the default close button", () => {
    renderDialog();
    expect(screen.getByText("Dialog title")).toHaveAttribute(
      "data-slot",
      "dialog-title",
    );
    expect(screen.getByText("Dialog description")).toHaveAttribute(
      "data-slot",
      "dialog-description",
    );
    expect(screen.getAllByText("Close").length).toBeGreaterThan(0);
  });

  it("omits the corner close button when showCloseButton is false", () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Bare</DialogTitle>
          <DialogDescription>d</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });

  it("renders a footer close button when requested", () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
          <DialogFooter showCloseButton>
            <span>actions</span>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
    expect(screen.getByText("actions")).toBeInTheDocument();
  });

  it("closes from a DialogClose element", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog defaultOpen onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>t</DialogTitle>
          <DialogDescription>d</DialogDescription>
          <DialogClose>Dismiss</DialogClose>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("t")).not.toBeInTheDocument();
  });
});

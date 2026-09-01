// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";

afterEach(cleanup);

describe("AlertDialog", () => {
  it("opens via the trigger and renders the composition", () => {
    render(
      <AlertDialog>
        <AlertDialogTrigger>delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>media</AlertDialogMedia>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>No undo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.queryByText("Are you sure?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("delete"));
    expect(screen.getByText("Are you sure?")).toHaveAttribute(
      "data-slot",
      "alert-dialog-title",
    );
    expect(screen.getByText("No undo.")).toHaveAttribute(
      "data-slot",
      "alert-dialog-description",
    );
    expect(screen.getByText("media")).toHaveAttribute(
      "data-slot",
      "alert-dialog-media",
    );
  });

  it("styles action and cancel as buttons with variants", () => {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>t</AlertDialogTitle>
          <AlertDialogDescription>d</AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const cancel = screen.getByText("Cancel");
    expect(cancel).toHaveAttribute("data-slot", "alert-dialog-cancel");
    expect(cancel).toHaveAttribute("data-variant", "outline");
    const action = screen.getByText("Delete");
    expect(action).toHaveAttribute("data-slot", "alert-dialog-action");
    expect(action).toHaveAttribute("data-variant", "destructive");
  });

  it("supports the sm size and closes on action click", () => {
    const onOpenChange = vi.fn();
    render(
      <AlertDialog defaultOpen onOpenChange={onOpenChange}>
        <AlertDialogContent size="sm">
          <AlertDialogTitle>t</AlertDialogTitle>
          <AlertDialogDescription>d</AlertDialogDescription>
          <AlertDialogAction>OK</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const content = document.querySelector(
      "[data-slot=alert-dialog-content]",
    ) as HTMLElement;
    expect(content).toHaveAttribute("data-size", "sm");
    fireEvent.click(screen.getByText("OK"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

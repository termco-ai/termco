// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Tab } from "../tabs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppCloseDialog,
  DeletedTabsDialog,
  KindCloseDialog,
} from "./CloseDialogPrompts";

afterEach(cleanup);

function editor(id: number, title: string): Tab {
  return {
    id,
    kind: "editor",
    title,
    rigId: "default",
    path: `/${title}`,
    dirty: true,
    preview: false,
  };
}

describe("KindCloseDialog", () => {
  it("stays closed without a pending kind close", () => {
    render(
      <KindCloseDialog
        pendingKindClose={null}
        onCancelKindClose={() => {}}
        onConfirmKindClose={() => {}}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("renders the prompt payload (editor dirty copy)", () => {
    render(
      <KindCloseDialog
        pendingKindClose={{
          id: 1,
          prompt: {
            title: "Unsaved Changes",
            body: '"notes.ts" has unsaved changes. Close anyway?',
            confirmLabel: "Close Anyway",
          },
        }}
        onCancelKindClose={() => {}}
        onConfirmKindClose={() => {}}
      />,
    );
    expect(screen.getByText("Unsaved Changes")).toBeInTheDocument();
    expect(
      screen.getByText('"notes.ts" has unsaved changes. Close anyway?'),
    ).toBeInTheDocument();
  });

  it("renders the terminal prompt payload and routes the buttons", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <KindCloseDialog
        pendingKindClose={{
          id: 3,
          prompt: {
            title: "Close Terminal?",
            body: "A process is running. Closing this tab will terminate it.",
          },
        }}
        onCancelKindClose={onCancel}
        onConfirmKindClose={onConfirm}
      />,
    );
    expect(
      screen.getByText(
        "A process is running. Closing this tab will terminate it.",
      ),
    ).toBeInTheDocument();
    // Default confirm label when the prompt omits one.
    fireEvent.click(screen.getByText("Close Anyway"));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("cancels when the dialog is dismissed", () => {
    const onCancel = vi.fn();
    render(
      <KindCloseDialog
        pendingKindClose={{
          id: 1,
          prompt: { title: "Unsaved Changes", body: "Close anyway?" },
        }}
        onCancelKindClose={onCancel}
        onConfirmKindClose={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("DeletedTabsDialog", () => {
  it("stays closed without pending tabs", () => {
    render(
      <DeletedTabsDialog
        tabs={[]}
        pendingDeleteTabs={null}
        onCancelDeleteClose={() => {}}
        onConfirmDeleteClose={() => {}}
      />,
    );
    expect(screen.queryByText("Unsaved Changes")).not.toBeInTheDocument();
  });

  it("names a single deleted tab", () => {
    render(
      <DeletedTabsDialog
        tabs={[editor(1, "gone.ts")]}
        pendingDeleteTabs={[1]}
        onCancelDeleteClose={() => {}}
        onConfirmDeleteClose={() => {}}
      />,
    );
    expect(
      screen.getByText(
        '"gone.ts" has unsaved changes. The file has been deleted. Close anyway?',
      ),
    ).toBeInTheDocument();
  });

  it("falls back to a generic prompt when the single tab is unknown", () => {
    render(
      <DeletedTabsDialog
        tabs={[]}
        pendingDeleteTabs={[1]}
        onCancelDeleteClose={() => {}}
        onConfirmDeleteClose={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "This file has unsaved changes. The file has been deleted. Close anyway?",
      ),
    ).toBeInTheDocument();
  });

  it("counts multiple deleted tabs", () => {
    render(
      <DeletedTabsDialog
        tabs={[editor(1, "a.ts"), editor(2, "b.ts")]}
        pendingDeleteTabs={[1, 2]}
        onCancelDeleteClose={() => {}}
        onConfirmDeleteClose={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "2 files have unsaved changes. They have been deleted. Close all anyway?",
      ),
    ).toBeInTheDocument();
  });

  it("routes cancel and confirm clicks", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <DeletedTabsDialog
        tabs={[editor(1, "a.ts")]}
        pendingDeleteTabs={[1]}
        onCancelDeleteClose={onCancel}
        onConfirmDeleteClose={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("Close Anyway"));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("AppCloseDialog", () => {
  it("stays closed while no close is pending", () => {
    render(
      <AppCloseDialog
        pendingAppClose={false}
        onCancelAppClose={() => {}}
        onConfirmAppClose={() => {}}
      />,
    );
    expect(screen.queryByText("Quit Termco?")).not.toBeInTheDocument();
  });

  it("prompts before quitting with a live process and routes the buttons", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <AppCloseDialog
        pendingAppClose
        onCancelAppClose={onCancel}
        onConfirmAppClose={onConfirm}
      />,
    );
    expect(screen.getByText("Quit Termco?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Quit Anyway"));
    expect(onConfirm).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});

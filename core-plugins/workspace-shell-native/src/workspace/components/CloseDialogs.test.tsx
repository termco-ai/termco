// @vitest-environment jsdom
import type { Tab } from "../tabs";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AppCloseDialog,
  BulkCloseDialog,
  DeletedTabsDialog,
  KindCloseDialog,
} from "./CloseDialogPrompts";
import { CloseDialogs } from "./CloseDialogs";

const captured = vi.hoisted(() => ({
  kind: null as ComponentProps<typeof KindCloseDialog> | null,
  deleted: null as ComponentProps<typeof DeletedTabsDialog> | null,
  bulk: null as ComponentProps<typeof BulkCloseDialog> | null,
  app: null as ComponentProps<typeof AppCloseDialog> | null,
}));

vi.mock("./CloseDialogPrompts", () => ({
  KindCloseDialog: (p: ComponentProps<typeof KindCloseDialog>) => {
    captured.kind = p;
    return <div data-testid="kind" />;
  },
  DeletedTabsDialog: (p: ComponentProps<typeof DeletedTabsDialog>) => {
    captured.deleted = p;
    return <div data-testid="deleted" />;
  },
  BulkCloseDialog: (p: ComponentProps<typeof BulkCloseDialog>) => {
    captured.bulk = p;
    return <div data-testid="bulk" />;
  },
  AppCloseDialog: (p: ComponentProps<typeof AppCloseDialog>) => {
    captured.app = p;
    return <div data-testid="app" />;
  },
}));

afterEach(cleanup);

describe("CloseDialogs", () => {
  it("mounts all four prompts and threads each its own props", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "editor",
        title: "a.ts",
        rigId: "default",
        path: "/a.ts",
        dirty: true,
        preview: false,
      },
    ];
    const pendingKindClose = {
      id: 2,
      prompt: { title: "Close Terminal?", body: "A process is running." },
    };
    const handlers = {
      onCancelKindClose: vi.fn(),
      onConfirmKindClose: vi.fn(),
      onCancelDeleteClose: vi.fn(),
      onConfirmDeleteClose: vi.fn(),
      onCancelBulkClose: vi.fn(),
      onConfirmBulkClose: vi.fn(),
      onCancelAppClose: vi.fn(),
      onConfirmAppClose: vi.fn(),
    };
    render(
      <CloseDialogs
        tabs={tabs}
        pendingKindClose={pendingKindClose}
        pendingDeleteTabs={[3, 4]}
        pendingBulkClose={[5]}
        pendingAppClose
        {...handlers}
      />,
    );
    expect(screen.getByTestId("kind")).toBeTruthy();
    expect(screen.getByTestId("deleted")).toBeTruthy();
    expect(screen.getByTestId("bulk")).toBeTruthy();
    expect(screen.getByTestId("app")).toBeTruthy();

    expect(captured.kind).toEqual({
      pendingKindClose,
      onCancelKindClose: handlers.onCancelKindClose,
      onConfirmKindClose: handlers.onConfirmKindClose,
    });
    expect(captured.deleted).toEqual({
      tabs,
      pendingDeleteTabs: [3, 4],
      onCancelDeleteClose: handlers.onCancelDeleteClose,
      onConfirmDeleteClose: handlers.onConfirmDeleteClose,
    });
    expect(captured.bulk).toEqual({
      pendingBulkClose: [5],
      onCancelBulkClose: handlers.onCancelBulkClose,
      onConfirmBulkClose: handlers.onConfirmBulkClose,
    });
    expect(captured.app).toEqual({
      pendingAppClose: true,
      onCancelAppClose: handlers.onCancelAppClose,
      onConfirmAppClose: handlers.onConfirmAppClose,
    });
  });
});

// @vitest-environment jsdom
import type { Tab } from "../tabs";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppOverlays, type AppOverlaysProps } from "./AppOverlays";
import type { CloseDialogs } from "./CloseDialogs";

type CloseDialogsProps = ComponentProps<typeof CloseDialogs>;

const captured = vi.hoisted(() => ({
  closeDialogs: null as CloseDialogsProps | null,
}));

vi.mock("./CloseDialogs", () => ({
  CloseDialogs: (p: CloseDialogsProps) => {
    captured.closeDialogs = p;
    return <div data-testid="close-dialogs" />;
  },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  captured.closeDialogs = null;
});

const terminalTab: Tab = {
  id: 1,
  kind: "terminal",
  title: "t",
  rigId: "default",
  paneTree: { kind: "leaf", id: 10 },
  activeLeafId: 10,
};
function makeProps(over?: Partial<AppOverlaysProps>): AppOverlaysProps {
  return {
    tabs: [terminalTab],
    pendingKindClose: null,
    onCancelKindClose: vi.fn(),
    onConfirmKindClose: vi.fn(),
    pendingDeleteTabs: null,
    onCancelDeleteClose: vi.fn(),
    onConfirmDeleteClose: vi.fn(),
    pendingBulkClose: null,
    onCancelBulkClose: vi.fn(),
    onConfirmBulkClose: vi.fn(),
    pendingAppClose: false,
    onCancelAppClose: vi.fn(),
    onConfirmAppClose: vi.fn(),
    ...over,
  };
}

describe("AppOverlays", () => {
  it("mounts only workspace-owned close chrome", () => {
    const props = makeProps();
    render(<AppOverlays {...props} />);
    expect(screen.getByTestId("close-dialogs")).toBeTruthy();
  });

  it("threads the close-dialog state through", () => {
    const pendingKindClose = {
      id: 5,
      prompt: { title: "Close Terminal?", body: "A process is running." },
    };
    const props = makeProps({
      pendingKindClose,
      pendingDeleteTabs: [6],
      pendingAppClose: true,
    });
    render(<AppOverlays {...props} />);
    expect(captured.closeDialogs).toMatchObject({
      pendingKindClose,
      pendingDeleteTabs: [6],
      pendingAppClose: true,
    });
    expect(captured.closeDialogs?.tabs).toBe(props.tabs);
    expect(captured.closeDialogs?.onConfirmKindClose).toBe(
      props.onConfirmKindClose,
    );
  });
});

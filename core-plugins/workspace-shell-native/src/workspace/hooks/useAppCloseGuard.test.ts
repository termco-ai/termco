// @vitest-environment jsdom
import type { DesktopWindowCapability } from "@termco/desktop-base";
import type { TerminalSessionsCapability } from "@termco/terminal-base";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppCloseGuard } from "./useAppCloseGuard";

type CloseEvent = { preventDefault: () => void };
type CloseHandler = (event: CloseEvent) => Promise<void>;

const windowMock = vi.hoisted(() => {
  const handlers: CloseHandler[] = [];
  const unlisten = vi.fn();
  return {
    handlers,
    unlisten,
    close: vi.fn(),
    onCloseRequested: vi.fn((h: CloseHandler) => {
      handlers.push(h);
      return unlisten;
    }),
  };
});

const busyCheck = vi.fn(async () => false);
const terminalSessions = {
  hasForegroundProcesses: busyCheck,
} as unknown as TerminalSessionsCapability;

function setup() {
  const render = renderHook(() =>
    useAppCloseGuard(
      windowMock as unknown as DesktopWindowCapability,
      terminalSessions,
    ),
  );
  return render;
}

async function requestClose() {
  const handler = windowMock.handlers[windowMock.handlers.length - 1];
  if (!handler) throw new Error("close handler not registered");
  const event = { preventDefault: vi.fn() };
  await act(() => handler(event));
  return event;
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  windowMock.handlers.length = 0;
  busyCheck.mockResolvedValue(false);
});

describe("useAppCloseGuard", () => {
  it("closes immediately when no terminal is busy", async () => {
    setup();
    await waitFor(() => expect(windowMock.handlers.length).toBe(1));
    const event = await requestClose();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(windowMock.close).toHaveBeenCalled();
  });

  it("closes immediately when there are no terminal leaves", async () => {
    setup();
    await waitFor(() => expect(windowMock.handlers.length).toBe(1));
    await requestClose();
    expect(busyCheck).toHaveBeenCalledOnce();
    expect(windowMock.close).toHaveBeenCalled();
  });

  it("prompts instead of closing when a terminal is busy", async () => {
    busyCheck.mockResolvedValue(true);
    const { result } = setup();
    await waitFor(() => expect(windowMock.handlers.length).toBe(1));
    const event = await requestClose();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(windowMock.close).not.toHaveBeenCalled();
    expect(result.current.pendingAppClose).toBe(true);
  });

  it("confirmAppClose force-closes and clears the prompt", async () => {
    busyCheck.mockResolvedValue(true);
    const { result } = setup();
    await waitFor(() => expect(windowMock.handlers.length).toBe(1));
    await requestClose();
    act(() => result.current.confirmAppClose());
    expect(result.current.pendingAppClose).toBe(false);
    expect(windowMock.close).toHaveBeenCalled();
    // Force flag set: the next OS close request passes straight through.
    const event = await requestClose();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("cancelAppClose clears the prompt without closing", async () => {
    busyCheck.mockResolvedValue(true);
    const { result } = setup();
    await waitFor(() => expect(windowMock.handlers.length).toBe(1));
    await requestClose();
    act(() => result.current.cancelAppClose());
    expect(result.current.pendingAppClose).toBe(false);
    expect(windowMock.close).not.toHaveBeenCalled();
  });

  it("unlistens on unmount", async () => {
    const { unmount } = setup();
    await waitFor(() => expect(windowMock.onCloseRequested).toHaveBeenCalled());
    unmount();
    expect(windowMock.unlisten).toHaveBeenCalled();
  });
});

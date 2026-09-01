// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "./usePresence";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

afterEach(cleanup);

describe("usePresence", () => {
  it("mounts immediately when open", () => {
    const { result } = renderHook(() => usePresence(true));
    expect(result.current).toEqual({ mounted: true, state: "open" });
  });

  it("is unmounted when initially closed", () => {
    const { result } = renderHook(() => usePresence(false));
    expect(result.current).toEqual({ mounted: false, state: "closed" });
  });

  it("keeps the node mounted for the exit duration after closing", () => {
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, 150),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("closed");

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(result.current.mounted).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.mounted).toBe(false);
  });

  it("cancels the pending unmount when reopened", () => {
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, 150),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ open: true });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toEqual({ mounted: true, state: "open" });
  });

  it("honors a custom exit duration", () => {
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, 500),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.mounted).toBe(true);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.mounted).toBe(false);
  });
});

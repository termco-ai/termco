// @vitest-environment jsdom
import type { PreferencesCapability } from "@termco/storage-base";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useZoom } from "./useZoom";

function preferences(initial = 1): PreferencesCapability & {
  set: ReturnType<typeof vi.fn>;
  publish(value: number): void;
} {
  let zoomLevel = initial;
  const listeners = new Set<(key: string, value: unknown) => void>();
  const set = vi.fn(async (key: string, value: unknown) => {
    if (key !== "zoomLevel" || typeof value !== "number") return;
    zoomLevel = value;
    for (const listener of listeners) listener(key, value);
  });
  return {
    get: async <T,>() => zoomLevel as T,
    getMany: vi.fn(async () => ({})),
    set,
    delete: vi.fn(async () => false),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(value) {
      zoomLevel = value;
      for (const listener of listeners) listener("zoomLevel", value);
    },
  };
}

beforeEach(() => {
  document.documentElement.style.removeProperty("--app-zoom");
});

afterEach(cleanup);

describe("workspace shell zoom", () => {
  it("loads and applies the persisted zoom through the public capability", async () => {
    renderHook(() => useZoom(preferences(1.2)));
    await waitFor(() =>
      expect(
        document.documentElement.style.getPropertyValue("--app-zoom"),
      ).toBe("1.2"),
    );
  });

  it("does not touch the DOM before the preference resolves", async () => {
    let resolve!: (value: number) => void;
    const prefs = preferences();
    prefs.get = (() =>
      new Promise<number>((done) => {
        resolve = done;
      })) as PreferencesCapability["get"];
    renderHook(() => useZoom(prefs));
    expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe(
      "",
    );
    await act(async () => resolve(1.5));
    expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe(
      "1.5",
    );
  });

  it("reacts to application-wide preference changes", async () => {
    const prefs = preferences();
    renderHook(() => useZoom(prefs));
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe(
        "1",
      ),
    );
    act(() => prefs.publish(1.4));
    expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe(
      "1.4",
    );
  });

  it("steps, clamps, rounds, and resets exactly like the established hook", async () => {
    const prefs = preferences(1.1);
    const rendered = renderHook(() => useZoom(prefs));
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe(
        "1.1",
      ),
    );

    act(() => rendered.result.current.zoomIn());
    await waitFor(() => expect(prefs.set).toHaveBeenLastCalledWith("zoomLevel", 1.2));

    prefs.publish(2);
    prefs.set.mockClear();
    act(() => rendered.result.current.zoomIn());
    expect(prefs.set).not.toHaveBeenCalled();

    prefs.publish(0.6);
    act(() => rendered.result.current.zoomOut());
    await waitFor(() => expect(prefs.set).toHaveBeenLastCalledWith("zoomLevel", 0.5));
    prefs.set.mockClear();
    act(() => rendered.result.current.zoomOut());
    expect(prefs.set).not.toHaveBeenCalled();

    prefs.publish(1.4);
    act(() => rendered.result.current.zoomReset());
    await waitFor(() => expect(prefs.set).toHaveBeenLastCalledWith("zoomLevel", 1));
  });
});

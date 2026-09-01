// @vitest-environment jsdom
import type {
  ApplicationUpdatesCapability,
  PluginReleaseUpdate,
  PluginReleaseUpdatesCapability,
} from "@termco/application-base";
import type { DesktopIntegrationCapability } from "@termco/desktop-base";
import type { ApplicationEventsCapability } from "@termco/events-base";
import type { HttpCapability } from "@termco/http-base";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUpdaterState,
  createUseUpdater,
  type UpdaterUiDependencies,
} from "./useUpdater";

const listeners = new Map<string, Set<(payload: unknown) => void>>();
const updates: ApplicationUpdatesCapability = {
  check: vi.fn(),
  downloadAndInstall: vi.fn(),
  install: vi.fn(),
};
const pluginUpdates: PluginReleaseUpdatesCapability = {
  check: vi.fn(),
  install: vi.fn(),
};
const events: ApplicationEventsCapability = {
  emit(event, payload) {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  },
  subscribe(event, listener) {
    const bucket = listeners.get(event) ?? new Set();
    bucket.add(listener);
    listeners.set(event, bucket);
    return () => bucket.delete(listener);
  },
  subscribeAll: () => () => {},
  listenerCount: (event) => listeners.get(event)?.size ?? 0,
};
const desktop = {
  relaunch: vi.fn(),
} as unknown as DesktopIntegrationCapability;
const http: HttpCapability = {
  ping: async () => 200,
  request: vi.fn(),
  stream: async () => async () => {},
};

function dependencies(
  overrides: Partial<UpdaterUiDependencies> = {},
): UpdaterUiDependencies {
  return {
    updates,
    events,
    desktop,
    http,
    platform: "darwin",
    currentVersion: "1.0.0",
    ...overrides,
  };
}

function available(version = "9.9.9") {
  return {
    available: true,
    version,
    currentVersion: "1.0.0",
    body: "notes",
  };
}

function pluginRelease(): PluginReleaseUpdate {
  return {
    releaseId: "plugins-2026.08.30.1",
    publishedAt: "2026-08-30T12:00:00.000Z",
    plugins: [
      {
        id: "preview-surface-native",
        name: "Preview Surface",
        currentVersion: "1.0.0",
        version: "1.1.0",
        notes: "Improves preview refresh behavior.",
      },
    ],
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  listeners.clear();
  vi.mocked(updates.check).mockReset();
  vi.mocked(updates.downloadAndInstall).mockReset();
  vi.mocked(pluginUpdates.check).mockReset();
  vi.mocked(pluginUpdates.install).mockReset();
  vi.mocked(desktop.relaunch).mockReset();
  vi.mocked(http.request).mockReset();
});

afterEach(cleanup);

describe("source-owned updater state", () => {
  it("publishes one shared snapshot to every update surface", async () => {
    vi.mocked(updates.check).mockResolvedValue(available("2.5.0"));
    const state = createUpdaterState(dependencies());
    const useUpdater = createUseUpdater(state);
    const first = renderHook(() => useUpdater({ autoCheck: false }));
    const second = renderHook(() => useUpdater({ autoCheck: false }));

    await act(() => first.result.current.check({ manual: true }));

    expect(first.result.current.status).toMatchObject({
      kind: "available",
      update: { version: "2.5.0" },
    });
    expect(second.result.current.status).toEqual(first.result.current.status);
    state.dispose();
  });

  it("can disable automatic checks and checks only once per app session", async () => {
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    renderHook(() => useUpdater({ autoCheck: false }));
    await act(async () => {});
    expect(updates.check).not.toHaveBeenCalled();
    cleanup();

    vi.mocked(updates.check).mockResolvedValue(null);
    const state = createUpdaterState(dependencies());
    const shared = createUseUpdater(state);
    renderHook(() => shared());
    renderHook(() => shared());
    await waitFor(() => expect(updates.check).toHaveBeenCalledTimes(1));
    state.dispose();
  });

  it("lets a manual check run after the startup check", async () => {
    vi.mocked(updates.check).mockResolvedValue(null);
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(updates.check).toHaveBeenCalledTimes(1));
    await act(() => result.current.check({ manual: true }));
    expect(updates.check).toHaveBeenCalledTimes(2);
    expect(result.current.status).toEqual({ kind: "uptodate" });
  });

  it("reports an available update from the startup check", async () => {
    vi.mocked(updates.check).mockResolvedValue(available());
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("available"));
  });

  it("checks again when a new app session creates a new updater state", async () => {
    vi.mocked(updates.check).mockResolvedValue(null);
    const firstState = createUpdaterState(dependencies());
    const first = renderHook(() => createUseUpdater(firstState)());
    await waitFor(() => expect(first.result.current.status.kind).toBe("uptodate"));
    firstState.dispose();
    cleanup();
    const secondState = createUpdaterState(dependencies());
    const second = renderHook(() => createUseUpdater(secondState)());
    await waitFor(() => expect(second.result.current.status.kind).toBe("uptodate"));
    expect(updates.check).toHaveBeenCalledTimes(2);
    secondState.dispose();
  });

  it("surfaces provider check failures", async () => {
    vi.mocked(updates.check).mockRejectedValue(new Error("network down"));
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("error"));
    expect(result.current.status).toMatchObject({
      kind: "error",
      message: expect.stringContaining("network down"),
    });
  });

  it("uses the manual GitHub flow on Linux", async () => {
    vi.mocked(http.request).mockResolvedValue({
      status: 200,
      headers: {},
      body: [
        ...new TextEncoder().encode(
          JSON.stringify({ tag_name: "v2.0.0", body: "", html_url: "u" }),
        ),
      ],
    });
    const useUpdater = createUseUpdater(
      createUpdaterState(dependencies({ platform: "linux" })),
    );
    const { result } = renderHook(() => useUpdater());
    await waitFor(() =>
      expect(result.current.status).toMatchObject({
        kind: "manual-available",
        info: { version: "2.0.0", currentVersion: "1.0.0" },
      }),
    );
    expect(updates.check).not.toHaveBeenCalled();
  });

  it("marks Linux up to date when no newer release exists", async () => {
    vi.mocked(http.request).mockResolvedValue({
      status: 200,
      headers: {},
      body: [
        ...new TextEncoder().encode(
          JSON.stringify({ tag_name: "v1.0.0", html_url: "u" }),
        ),
      ],
    });
    const useUpdater = createUseUpdater(
      createUpdaterState(dependencies({ platform: "linux" })),
    );
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("uptodate"));
  });

  it("streams shared progress, reaches ready, relaunches, and unsubscribes", async () => {
    vi.mocked(updates.check).mockResolvedValue(available());
    let finish!: () => void;
    vi.mocked(updates.downloadAndInstall).mockImplementation(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("available"));

    let installing!: Promise<void>;
    act(() => { installing = result.current.install(); });
    expect(result.current.status).toEqual({
      kind: "downloading",
      downloaded: 0,
      contentLength: null,
    });
    act(() => events.emit("updater://progress", {
      event: "Started",
      data: { contentLength: 100 },
    }));
    act(() => events.emit("updater://progress", {
      event: "Progress",
      data: { chunkLength: 40 },
    }));
    act(() => events.emit("updater://progress", {
      event: "Progress",
      data: { chunkLength: 25 },
    }));
    expect(result.current.status).toEqual({
      kind: "downloading",
      downloaded: 65,
      contentLength: 100,
    });
    act(() => events.emit("updater://progress", { event: "Finished" }));
    expect(result.current.status).toEqual({ kind: "ready" });
    await act(async () => { finish(); await installing; });
    expect(desktop.relaunch).toHaveBeenCalled();
    expect(events.listenerCount("updater://progress")).toBe(0);
  });

  it("does not install without an available update", async () => {
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    const { result } = renderHook(() => useUpdater({ autoCheck: false }));
    await act(() => result.current.install());
    expect(updates.downloadAndInstall).not.toHaveBeenCalled();
    expect(result.current.status).toEqual({ kind: "idle" });
  });

  it("surfaces installation failure and cleans up progress", async () => {
    vi.mocked(updates.check).mockResolvedValue(available());
    vi.mocked(updates.downloadAndInstall).mockRejectedValue(
      new Error("disk full"),
    );
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("available"));
    await act(() => result.current.install());
    expect(result.current.status).toMatchObject({ kind: "error" });
    expect(desktop.relaunch).not.toHaveBeenCalled();
    expect(events.listenerCount("updater://progress")).toBe(0);
  });

  it("dismisses back to idle", async () => {
    vi.mocked(updates.check).mockResolvedValue(available("2.0.0"));
    const useUpdater = createUseUpdater(createUpdaterState(dependencies()));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("available"));
    act(() => result.current.dismiss());
    expect(result.current.status).toEqual({ kind: "idle" });
  });

  it("presents and live-installs a confirmed plugin set without relaunching", async () => {
    vi.mocked(updates.check).mockResolvedValue(null);
    vi.mocked(pluginUpdates.check).mockResolvedValue({
      kind: "available",
      release: pluginRelease(),
    });
    vi.mocked(pluginUpdates.install).mockResolvedValue({
      status: "installed",
      release: pluginRelease(),
    });
    const useUpdater = createUseUpdater(
      createUpdaterState(dependencies({ pluginUpdates })),
    );
    const { result } = renderHook(() => useUpdater());
    await waitFor(() =>
      expect(result.current.status.kind).toBe("plugin-available"),
    );
    await act(() => result.current.install());
    expect(pluginUpdates.install).toHaveBeenCalledWith(
      "plugins-2026.08.30.1",
    );
    expect(result.current.status).toMatchObject({ kind: "plugin-installed" });
    expect(desktop.relaunch).not.toHaveBeenCalled();
  });

  it("publishes plugin download and preparation progress while installing", async () => {
    vi.mocked(updates.check).mockResolvedValue(null);
    vi.mocked(pluginUpdates.check).mockResolvedValue({
      kind: "available",
      release: pluginRelease(),
    });
    let finish!: () => void;
    vi.mocked(pluginUpdates.install).mockImplementation(
      () => new Promise((resolve) => {
        finish = () => resolve({ status: "installed", release: pluginRelease() });
      }),
    );
    const useUpdater = createUseUpdater(
      createUpdaterState(dependencies({ pluginUpdates })),
    );
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("plugin-available"));

    let installing!: Promise<void>;
    act(() => { installing = result.current.install(); });
    act(() => events.emit("updater://plugin-progress", {
      stage: "downloading",
      completed: 40,
      total: 100,
      downloadedBytes: 40,
      totalBytes: 100,
    }));
    expect(result.current.status).toMatchObject({
      kind: "plugin-installing",
      progress: {
        stage: "downloading",
        downloadedBytes: 40,
        totalBytes: 100,
      },
    });
    act(() => events.emit("updater://plugin-progress", {
      stage: "preparing",
      completed: 0,
      total: 1,
      pluginName: "Preview Surface",
    }));
    expect(result.current.status).toMatchObject({
      kind: "plugin-installing",
      progress: { stage: "preparing", pluginName: "Preview Surface" },
    });

    await act(async () => { finish(); await installing; });
    expect(events.listenerCount("updater://plugin-progress")).toBe(0);
  });

  it("gives a full application update precedence over a plugin set", async () => {
    vi.mocked(updates.check).mockResolvedValue(available("2.0.0"));
    vi.mocked(pluginUpdates.check).mockResolvedValue({
      kind: "available",
      release: pluginRelease(),
    });
    const useUpdater = createUseUpdater(
      createUpdaterState(dependencies({ pluginUpdates })),
    );
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("available"));
    expect(result.current.status).toMatchObject({
      kind: "available",
      update: { version: "2.0.0" },
    });
  });

  it("still offers an application update when the plugin feed fails", async () => {
    vi.mocked(updates.check).mockResolvedValue(available("2.0.0"));
    vi.mocked(pluginUpdates.check).mockRejectedValue(new Error("catalog unavailable"));
    const useUpdater = createUseUpdater(
      createUpdaterState(dependencies({ pluginUpdates })),
    );
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status.kind).toBe("available"));
    expect(result.current.status).toMatchObject({
      kind: "available",
      update: { version: "2.0.0" },
    });
  });

  it("keeps Later dismissed across application sessions for the same release", async () => {
    vi.mocked(updates.check).mockResolvedValue(null);
    vi.mocked(pluginUpdates.check).mockResolvedValue({
      kind: "available",
      release: pluginRelease(),
    });
    const useUpdater = createUseUpdater(
      createUpdaterState(dependencies({ pluginUpdates })),
    );
    const { result } = renderHook(() => useUpdater());
    await waitFor(() =>
      expect(result.current.status.kind).toBe("plugin-available"),
    );
    act(() => result.current.dismiss());
    expect(result.current.status).toEqual({ kind: "idle" });
    const nextSession = createUseUpdater(
      createUpdaterState(dependencies({ pluginUpdates })),
    );
    const next = renderHook(() => nextSession());
    await waitFor(() => expect(next.result.current.status.kind).toBe("idle"));
    await act(() => result.current.check({ manual: true }));
    expect(result.current.status.kind).toBe("plugin-available");
  });
});

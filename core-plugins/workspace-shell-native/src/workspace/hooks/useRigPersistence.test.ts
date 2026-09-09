// @vitest-environment jsdom
import type { Tab } from "../tabs";
import type { WorkspaceRigTabLayout, WorkspaceTabsCapability } from "@termco/workspace-base";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRigPersistence } from "./useRigPersistence";

const tabsProvider = {
  savedLayouts: vi.fn(
    () =>
      [] as Array<{
        rigId: string;
        tabs: Array<{ kind: string; [key: string]: unknown }>;
        activeTabIndex: number;
        splitTabIndex: number;
      }>,
  ),
  saveLayout: vi.fn<(layout: WorkspaceRigTabLayout) => Promise<void>>(
    async () => {},
  ),
} as unknown as WorkspaceTabsCapability;

const DEBOUNCE_MS = 3000;

function term(id: number, rigId: string, over: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: "terminal",
    rigId,
    title: "shell",
    cwd: `/w/${id}`,
    paneTree: { kind: "leaf", id: id * 10, cwd: `/w/${id}` },
    activeLeafId: id * 10,
    ...over,
  } as Tab;
}

type Params = {
  tabs: Tab[];
  activeId: number;
  activeRigId: string;
  enabled: boolean;
  splitTabId?: number;
  splitDirection?: "horizontal" | "vertical";
  splitPlacement?: "before" | "after";
};

function mount(initial: Params) {
  return renderHook(
    (params: Params) =>
      useRigPersistence({
        splitTabId: 0,
        workspaceTabs: tabsProvider,
        ...params,
      }),
    { initialProps: initial },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(tabsProvider.savedLayouts).mockReturnValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useRigPersistence", () => {
  it("persists orientation changes even when the tab selection is unchanged", () => {
    const params: Params = { tabs: [term(1, "a"), term(2, "a")], activeId: 1,
      activeRigId: "a", splitTabId: 2, splitDirection: "vertical", enabled: true };
    const { rerender } = mount(params);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(tabsProvider.saveLayout).toHaveBeenLastCalledWith(expect.objectContaining({ splitDirection: "vertical" }));
    rerender({ ...params, splitDirection: "horizontal" });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(2);
    expect(tabsProvider.saveLayout).toHaveBeenLastCalledWith(expect.objectContaining({ splitDirection: "horizontal" }));
    rerender({ ...params, splitDirection: "horizontal", splitPlacement: "before" });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(3);
    expect(tabsProvider.saveLayout).toHaveBeenLastCalledWith(expect.objectContaining({ splitPlacement: "before" }));
  });

  it("writes nothing while disabled", () => {
    mount({
      tabs: [term(1, "a")],
      activeId: 1,
      activeRigId: "a",
      enabled: false,
    });
    vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    expect(tabsProvider.saveLayout).not.toHaveBeenCalled();
  });

  it("flushes the active rig after the debounce", () => {
    mount({
      tabs: [term(1, "a"), term(2, "a")],
      activeId: 2,
      activeRigId: "a",
      enabled: true,
    });
    expect(tabsProvider.saveLayout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(1);
    const [state] = vi.mocked(tabsProvider.saveLayout).mock.calls[0];
    expect(state.rigId).toBe("a");
    expect(state.activeTabIndex).toBe(1);
    expect(state.splitTabIndex).toBe(-1);
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0].kind).toBe("terminal");
  });

  it("persists the split tab index for the active rig", () => {
    mount({
      tabs: [term(1, "a"), term(2, "a"), term(3, "a")],
      activeId: 1,
      splitTabId: 3,
      activeRigId: "a",
      enabled: true,
    });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const [state] = vi.mocked(tabsProvider.saveLayout).mock.calls[0];
    expect(state.activeTabIndex).toBe(0);
    expect(state.splitTabIndex).toBe(2);
  });

  it("skips unchanged snapshots on subsequent flushes", () => {
    const params: Params = {
      tabs: [term(1, "a")],
      activeId: 1,
      activeRigId: "a",
      enabled: true,
    };
    const { rerender } = mount(params);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(1);
    rerender({ ...params, tabs: [term(1, "a")] });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(1);
  });

  it("computes the active index among serializable tabs only", () => {
    mount({
      tabs: [term(1, "a", { private: true }), term(2, "a"), term(3, "a")],
      activeId: 3,
      activeRigId: "a",
      enabled: true,
    });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const [state] = vi.mocked(tabsProvider.saveLayout).mock.calls[0];
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabIndex).toBe(1);
  });

  it("preserves the seeded active index for rigs never visited", () => {
    vi.mocked(tabsProvider.savedLayouts).mockReturnValue([
      {
        rigId: "b",
        tabs: [
          { kind: "terminal" },
          { kind: "terminal" },
          { kind: "terminal" },
        ],
        activeTabIndex: 2,
        splitTabIndex: -1,
      },
    ]);
    mount({
      tabs: [term(1, "a"), term(2, "b"), term(3, "b"), term(4, "b")],
      activeId: 1,
      activeRigId: "a",
      enabled: true,
    });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const forB = vi
      .mocked(tabsProvider.saveLayout)
      .mock.calls.find(([layout]) => layout.rigId === "b");
    expect(forB?.[0].activeTabIndex).toBe(2);
  });

  it("flushes immediately when the document becomes hidden", () => {
    mount({
      tabs: [term(1, "a")],
      activeId: 1,
      activeRigId: "a",
      enabled: true,
    });
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("flushes on window blur", () => {
    mount({
      tabs: [term(1, "a")],
      activeId: 1,
      activeRigId: "a",
      enabled: true,
    });
    window.dispatchEvent(new Event("blur"));
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest snapshot on unmount", () => {
    const { unmount } = mount({
      tabs: [term(1, "a")],
      activeId: 1,
      activeRigId: "a",
      enabled: true,
    });
    unmount();
    expect(tabsProvider.saveLayout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tabsProvider.saveLayout).mock.calls[0][0].rigId).toBe(
      "a",
    );
  });
});

it.each(["move", "close"])("clears the old saved layout after the final tab %s", (action) => {
  const initial: Params = { tabs: [term(1, "a")], activeId: 1, activeRigId: "a", enabled: true };
  const { rerender } = mount(initial);
  vi.advanceTimersByTime(DEBOUNCE_MS);
  rerender({ ...initial, tabs: action === "move" ? [term(1, "b")] : [], activeRigId: "b" });
  vi.advanceTimersByTime(DEBOUNCE_MS);
  const writes = vi.mocked(tabsProvider.saveLayout).mock.calls.filter(([layout]) => layout.rigId === "a");
  expect(writes.at(-1)?.[0]).toEqual({ rigId: "a", tabs: [], activeTabIndex: 0, splitTabIndex: -1 });
});

it("does not resurrect the saved layout of a deleted rig", () => {
  let rigIds = ["a"];
  const rigs = { snapshot: () => ({ rigs: rigIds.map((id) => ({ id })) }) };
  const { rerender } = renderHook(({ tabs }: { tabs: Tab[] }) => useRigPersistence({
    tabs, activeId: 1, splitTabId: 0, activeRigId: "a", enabled: true,
    workspaceTabs: tabsProvider, rigs: rigs as never,
  }), { initialProps: { tabs: [term(1, "a")] } });
  vi.advanceTimersByTime(DEBOUNCE_MS);
  vi.mocked(tabsProvider.saveLayout).mockClear();
  rigIds = [];
  rerender({ tabs: [] });
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(tabsProvider.saveLayout).not.toHaveBeenCalled();
});

it("keeps unvisited saved layouts until their tabs have been loaded", () => {
  vi.mocked(tabsProvider.savedLayouts).mockReturnValue([{ rigId: "offline", tabs: [{ kind: "terminal" }], activeTabIndex: 0, splitTabIndex: -1 }]);
  mount({ tabs: [term(1, "a")], activeId: 1, activeRigId: "a", enabled: true });
  vi.advanceTimersByTime(DEBOUNCE_MS);
  expect(vi.mocked(tabsProvider.saveLayout).mock.calls.map(([layout]) => layout.rigId)).toEqual(["a"]);
});

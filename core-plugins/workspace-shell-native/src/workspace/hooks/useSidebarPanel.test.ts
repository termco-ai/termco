// @vitest-environment jsdom
import type {
  UiSidebarNavigationCapability,
  UiSidebarNavigationSnapshot,
  UiSidebarPanelHandle,
} from "@termco/ui-sidebar-base";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarPanel } from "./useSidebarPanel";

type FocusableExplorer = { focus: () => void; isFocused: () => boolean };

function navigation(initial?: Partial<UiSidebarNavigationSnapshot>) {
  let state: UiSidebarNavigationSnapshot = {
    revision: 0,
    view: "explorer",
    initialCollapsed: false,
    width: 308,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<UiSidebarNavigationSnapshot>) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    for (const listener of listeners) listener();
  };
  const capability: UiSidebarNavigationCapability = {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bindPanel: vi.fn(),
    select: vi.fn((view) => publish({ view })),
    show: vi.fn((view) => publish({ view })),
    toggle: vi.fn(),
    setCollapsed: vi.fn(),
    setWidth: vi.fn((width) => publish({ width })),
    dispose: vi.fn(),
  };
  return capability;
}

function panel(collapsed = false): UiSidebarPanelHandle {
  return {
    isCollapsed: () => collapsed,
    resize: vi.fn(),
    collapse: vi.fn(),
  };
}

function setup(input?: {
  navigation?: UiSidebarNavigationCapability;
  explorer?: FocusableExplorer | null;
  collapsed?: boolean;
}) {
  const capability = input?.navigation ?? navigation();
  const explorerRef: RefObject<FocusableExplorer | null> = {
    current: input?.explorer ?? null,
  };
  const rendered = renderHook(() =>
    useSidebarPanel(capability, explorerRef),
  );
  const handle = panel(input?.collapsed);
  act(() => {
    rendered.result.current.sidebarRef.current = handle as never;
  });
  return { ...rendered, capability, explorerRef, handle };
}

afterEach(cleanup);

describe("useSidebarPanel", () => {
  it("invokes provider methods with their capability receiver", () => {
    class ReceiverSensitiveNavigation
      implements UiSidebarNavigationCapability
    {
      #state: UiSidebarNavigationSnapshot = {
        revision: 0,
        view: "explorer",
        initialCollapsed: false,
        width: 308,
      };

      snapshot() {
        return this.#state;
      }
      subscribe() {
        void this.#state;
        return () => undefined;
      }
      bindPanel() {}
      select() {}
      show() {}
      toggle() {}
      setCollapsed() {}
      setWidth() {}
      dispose() {}
    }

    const { result } = setup({
      navigation: new ReceiverSensitiveNavigation(),
    });
    expect(result.current.sidebarView).toBe("explorer");
  });

  it("projects the provider snapshot without owning a second store", () => {
    const capability = navigation({
      view: "source-control",
      initialCollapsed: true,
      width: 344,
    });
    const { result } = setup({ navigation: capability });
    expect(result.current.sidebarView).toBe("source-control");
    expect(result.current.initialSidebarCollapsed).toBe(true);
    expect(result.current.sidebarWidthRef.current).toBe(344);
    act(() => capability.select("ports"));
    expect(result.current.sidebarView).toBe("ports");
  });

  it("binds the resizable handle directly to the selected provider", () => {
    const { capability, handle, unmount } = setup();
    expect(capability.bindPanel).toHaveBeenLastCalledWith(handle);
    unmount();
    expect(capability.bindPanel).toHaveBeenLastCalledWith(null);
  });

  it("delegates navigation, collapse, width, and toggle workflows", () => {
    const { result, capability } = setup();
    act(() => {
      result.current.persistSidebarView("ports");
      result.current.persistSidebarCollapsed(true);
      result.current.persistSidebarWidth(320);
      result.current.toggleSidebar();
      result.current.cycleSidebarView("source-control");
    });
    expect(capability.show).toHaveBeenNthCalledWith(1, "ports");
    expect(capability.select).not.toHaveBeenCalled();
    expect(capability.setCollapsed).toHaveBeenCalledWith(true);
    expect(capability.setWidth).toHaveBeenCalledWith(320);
    expect(capability.toggle).toHaveBeenCalledOnce();
    expect(capability.show).toHaveBeenNthCalledWith(2, "source-control");
  });

  it("focuses a visible explorer without changing navigation", () => {
    const explorer = { focus: vi.fn(), isFocused: () => false };
    const { result, capability } = setup({ explorer });
    act(() => result.current.toggleExplorerFocus());
    expect(explorer.focus).toHaveBeenCalledOnce();
    expect(capability.select).not.toHaveBeenCalled();
  });

  it("selects and focuses Explorer when another view is active", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const capability = navigation({ view: "ports" });
    const explorer = { focus: vi.fn(), isFocused: () => false };
    const { result } = setup({ navigation: capability, explorer });
    act(() => result.current.toggleExplorerFocus());
    expect(capability.select).toHaveBeenCalledWith("explorer");
    expect(explorer.focus).toHaveBeenCalledOnce();
    raf.mockRestore();
  });

  it("expands a collapsed panel to the provider-owned width", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const explorer = { focus: vi.fn(), isFocused: () => false };
    const { result, handle } = setup({ explorer, collapsed: true });
    act(() => result.current.toggleExplorerFocus());
    expect(handle.resize).toHaveBeenCalledWith("308px");
    expect(explorer.focus).toHaveBeenCalledOnce();
    raf.mockRestore();
  });

  it("returns focus to the element used before Explorer", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    const explorer = { focus: vi.fn(), isFocused: vi.fn(() => false) };
    const { result } = setup({ explorer });
    act(() => result.current.toggleExplorerFocus());
    explorer.isFocused.mockReturnValue(true);
    act(() => result.current.toggleExplorerFocus());
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});

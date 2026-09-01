/**
 * React/DOM adapter for the selected sidebar-navigation provider. The source
 * plugin owns navigation state, persistence, width, and collapse workflows;
 * this hook only binds the resizable panel and coordinates browser focus with
 * the mounted explorer controller.
 */
import type { UiSidebarNavigationCapability } from "@termco/ui-sidebar-base";
import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

type FocusableExplorer = {
  focus: () => void;
  isFocused: () => boolean;
};

export function useSidebarPanel(
  navigation: UiSidebarNavigationCapability,
  explorerRef: RefObject<FocusableExplorer | null>,
) {
  const subscribeNavigation = useCallback(
    (listener: () => void) => navigation.subscribe(listener),
    [navigation],
  );
  const snapshotNavigation = useCallback(
    () => navigation.snapshot(),
    [navigation],
  );
  const navigationState = useSyncExternalStore(
    subscribeNavigation,
    snapshotNavigation,
    snapshotNavigation,
  );
  const sidebarRef = useMemo(() => {
    let current: PanelImperativeHandle | null = null;
    return {
      get current() {
        return current;
      },
      set current(panel: PanelImperativeHandle | null) {
        current = panel;
        navigation.bindPanel(panel);
      },
    } as RefObject<PanelImperativeHandle | null>;
  }, [navigation]);
  const sidebarWidthRef = useRef(navigationState.width);
  sidebarWidthRef.current = navigationState.width;
  const initialSidebarCollapsed = useRef(
    navigationState.initialCollapsed,
  ).current;
  const explorerReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    navigation.bindPanel(sidebarRef.current);
    return () => navigation.bindPanel(null);
  }, [navigation, sidebarRef]);

  const persistSidebarView = useCallback(
    (view: string) => navigation.show(view),
    [navigation],
  );
  const persistSidebarCollapsed = useCallback(
    (collapsed: boolean) => navigation.setCollapsed(collapsed),
    [navigation],
  );
  const toggleSidebar = useCallback(
    () => navigation.toggle(),
    [navigation],
  );
  const cycleSidebarView = useCallback(
    (view: string) => navigation.show(view),
    [navigation],
  );
  const persistSidebarWidth = useCallback(
    (next: number) => navigation.setWidth(next),
    [navigation],
  );

  const toggleExplorerFocus = useCallback(() => {
    const explorer = explorerRef.current;
    const panel = sidebarRef.current;
    const collapsed = panel?.isCollapsed() ?? false;
    if (navigationState.view !== "explorer" || collapsed) {
      if (panel && collapsed) panel.resize(`${navigationState.width}px`);
      if (navigationState.view !== "explorer") {
        navigation.select("explorer");
      }
      const active = document.activeElement;
      explorerReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      requestAnimationFrame(() => explorerRef.current?.focus());
      return;
    }
    if (!explorer) return;
    if (explorer.isFocused()) {
      const target = explorerReturnFocusRef.current;
      explorerReturnFocusRef.current = null;
      if (target && document.body.contains(target)) {
        target.focus();
      } else {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    const active = document.activeElement;
    explorerReturnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    explorer.focus();
  }, [
    explorerRef,
    navigation,
    navigationState.view,
    navigationState.width,
    sidebarRef,
  ]);

  return {
    sidebarRef,
    sidebarWidthRef,
    sidebarView: navigationState.view,
    initialSidebarCollapsed,
    persistSidebarView,
    persistSidebarCollapsed,
    toggleSidebar,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  };
}

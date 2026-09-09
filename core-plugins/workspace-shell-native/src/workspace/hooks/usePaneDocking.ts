import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { dockLayout, workspaceSnapTarget, type SnapTarget } from "@termco/ui-shell-base";

export type PaneId = "left" | "right";
export type DockPane = (pane: PaneId, direction: "horizontal" | "vertical", placement: "before" | "after") => void;

type Gesture = {
  pane: PaneId;
  element: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  previousUserSelect: string;
};

export function usePaneDocking(surface: RefObject<HTMLElement | null>, onDock?: DockPane) {
  const gesture = useRef<Gesture | null>(null);
  const [target, setTarget] = useState<SnapTarget>(null);
  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current) {
      if (current.active) document.body.style.userSelect = current.previousUserSelect;
      if (current.element.hasPointerCapture(current.pointerId)) {
        current.element.releasePointerCapture(current.pointerId);
      }
    }
    setTarget(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !gesture.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [cancel]);

  function hitTest(event: PointerEvent<HTMLElement>): SnapTarget {
    return surface.current
      ? workspaceSnapTarget(surface.current.getBoundingClientRect(), event.clientX, event.clientY)
      : null;
  }

  return {
    target,
    handlers(pane: PaneId) {
      return {
        onPointerDown(event: PointerEvent<HTMLElement>) {
          if (!onDock || event.button !== 0 || gesture.current) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {
            pane, element: event.currentTarget, pointerId: event.pointerId,
            startX: event.clientX, startY: event.clientY, active: false,
            previousUserSelect: document.body.style.userSelect,
          };
        },
        onPointerMove(event: PointerEvent<HTMLElement>) {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          if (!current.active) {
            if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return;
            current.active = true;
            document.body.style.userSelect = "none";
          }
          event.preventDefault();
          setTarget(hitTest(event));
        },
        onPointerUp(event: PointerEvent<HTMLElement>) {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          const destination = current.active ? hitTest(event) : null;
          // Release capture before React moves the pane in the DOM.
          cancel();
          if (destination && destination !== "center") onDock?.(current.pane, ...dockLayout(destination));
        },
        onPointerCancel: cancel,
        onLostPointerCapture: cancel,
      };
    },
  };
}

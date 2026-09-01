/**
 * Detects whether a floating overlay is currently open, so the embedded
 * browser (a native WebContentsView that always paints above the DOM) can be
 * hidden while one is up.
 *
 * Two sources, OR'd together:
 *  - DOM observation for Radix overlays. Radix Content components mount into
 *    the tree even while CLOSED, so counting their mounts is unreliable — but
 *    Radix only inserts the *popper wrapper* / flips content to
 *    `data-state="open"` when actually open. A MutationObserver watches for
 *    that and recomputes.
 *  - A manual counter for non-Radix floating surfaces (the AI mini window, the
 *    tab switcher HUD, the selection "Ask AI" popup) which are presence-mounted
 *    (in the DOM only while shown) and call `useOverlayGuard()`.
 */
import { type RefObject, useEffect, useSyncExternalStore } from "react";

// Non-Radix floating surfaces come in two flavours: those that expose a DOM
// element (via a ref) so we can tell whether they actually cover a native view,
// and those that don't (`manualCount`) and must hide it conservatively.
let manualCount = 0;
const manualRefs = new Set<RefObject<HTMLElement | null>>();
let version = 0;
const listeners = new Set<() => void>();

// Open Radix surfaces: popper-based menus/popovers/selects/hovercards wrap
// their content in [data-radix-popper-content-wrapper] only while open;
// dialogs/alert-dialogs/sheets carry data-state="open" on open content.
const OPEN_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-slot="sheet-content"][data-state="open"]',
].join(",");

let domOpen = false;
let observer: MutationObserver | null = null;

function computeDomOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(OPEN_SELECTOR) !== null
  );
}

function ensureObserver(): void {
  if (observer || typeof document === "undefined" || !document.body) return;
  observer = new MutationObserver(() => {
    const next = computeDomOpen();
    if (next !== domOpen) {
      domOpen = next;
      notify();
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-state"],
  });
  domOpen = computeDomOpen();
}

function notify(): void {
  version += 1;
  for (const cb of [...listeners]) cb();
}

/** Monotonic counter bumped on every overlay open/close — a stable snapshot for
 * useSyncExternalStore so consumers can recompute rects when overlays change. */
function overlaysVersion(): number {
  return version;
}

/** True only when a non-queryable manual overlay (tab HUD, selection popup) is
 * up — those have no rect, so a native view must hide conservatively. Manual
 * overlays that registered a ref are reported via `openOverlayRects` instead. */
export function manualOverlayOpen(): boolean {
  return manualCount > 0;
}

/** On-screen rects of everything currently open that can occlude a native
 * view: Radix popper wrappers / open dialogs & sheets, plus ref-registered
 * manual surfaces (e.g. the draggable mini window). Lets a native view decide
 * whether an overlay actually covers it, instead of hiding for any overlay
 * anywhere in the window. */
export function openOverlayRects(): DOMRect[] {
  if (typeof document === "undefined") return [];
  const rects = Array.from(document.querySelectorAll(OPEN_SELECTOR), (el) =>
    el.getBoundingClientRect(),
  );
  for (const ref of manualRefs) {
    const el = ref.current;
    if (el) rects.push(el.getBoundingClientRect());
  }
  return rects;
}

/** Nudge subscribers to recompute — for a registered surface that moves without
 * opening/closing (the mini window dragging across the view). */
export function pingOverlays(): void {
  notify();
}

export function useOverlaysVersion(): number {
  return useSyncExternalStore(subscribeOverlays, overlaysVersion);
}

export function incrementOverlays(): void {
  manualCount += 1;
  notify();
}

export function decrementOverlays(): void {
  manualCount = Math.max(0, manualCount - 1);
  notify();
}

export function anyOverlayOpen(): boolean {
  return manualCount > 0 || manualRefs.size > 0 || domOpen;
}

export function subscribeOverlays(cb: () => void): () => void {
  ensureObserver();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Mount inside a non-Radix floating surface that is only present in the DOM
 * while shown (mounted ⇔ open). Radix overlays do NOT need this — they're
 * detected via the DOM observer.
 *
 * Pass the surface's element ref to make it rect-aware: a native view then
 * hides only when the surface actually overlaps it (e.g. the mini window is
 * dragged over the browser). Without a ref, the surface hides native views
 * conservatively whenever it's up.
 */
export function useOverlayGuard(ref?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (ref) {
      manualRefs.add(ref);
      notify();
      return () => {
        manualRefs.delete(ref);
        notify();
      };
    }
    incrementOverlays();
    return decrementOverlays;
  }, [ref]);
}

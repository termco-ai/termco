import type { PreferencesCapability } from "@termco/storage-base";
import { useCallback, useEffect, useRef, useState } from "react";

const ZOOM_KEY = "zoomLevel";
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const CSS_VAR = "--app-zoom";

function clampZoom(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

function validZoom(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampZoom(value)
    : 1;
}

function applyToDom(value: number): void {
  document.documentElement.style.setProperty(CSS_VAR, String(value));
}

/** Exact established application-zoom behavior owned by the copyable
 * workspace-shell plugin. Persistence and cross-window publication remain in
 * the selected application-wide preferences provider. */
export function useZoom(preferences: PreferencesCapability) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const currentRef = useRef(1);

  useEffect(() => {
    let active = true;
    let publication = 0;
    const update = (value: unknown) => {
      const next = validZoom(value);
      currentRef.current = next;
      setZoomLevel(next);
      setHydrated(true);
    };
    const unsubscribe = preferences.subscribe((key, value) => {
      if (key !== ZOOM_KEY) return;
      publication += 1;
      if (active) update(value);
    });
    const publicationAtRead = publication;
    void preferences
      .get<number>(ZOOM_KEY)
      .then((value) => {
        if (active && publication === publicationAtRead) update(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [preferences]);

  useEffect(() => {
    if (hydrated) applyToDom(zoomLevel);
  }, [hydrated, zoomLevel]);

  const persist = useCallback(
    (next: number) => {
      if (next === currentRef.current) return;
      void preferences.set(ZOOM_KEY, next);
    },
    [preferences],
  );
  const zoomIn = useCallback(
    () => persist(clampZoom(currentRef.current + ZOOM_STEP)),
    [persist],
  );
  const zoomOut = useCallback(
    () => persist(clampZoom(currentRef.current - ZOOM_STEP)),
    [persist],
  );
  const zoomReset = useCallback(() => persist(1), [persist]);

  return { zoomIn, zoomOut, zoomReset };
}

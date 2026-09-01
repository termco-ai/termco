/**
 * Window geometry persistence. Saves each window's bounds to userData and
 * restores them on next launch (per label).
 *
 * `resize`/`move` fire many times per second during an interactive drag —
 * persisting synchronously on every event used to hammer the main thread with
 * read+parse+stringify+write disk IO for the whole drag. Instead the store is
 * kept in memory (loaded once) and flushed with a trailing debounce via async
 * IO; only `close` flushes synchronously (last chance before the window dies).
 */
import { app, type BrowserWindow, type Rectangle } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

type Store = Record<string, Rectangle>;

const SAVE_DEBOUNCE_MS = 500;

function file(): string {
  return join(app.getPath("userData"), "window-state.json");
}

let store: Store | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loaded(): Store {
  if (store) return store;
  try {
    store = JSON.parse(readFileSync(file(), "utf8")) as Store;
  } catch {
    store = {};
  }
  return store;
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = JSON.stringify(store ?? {}, null, 2);
    void writeFile(file(), data, "utf8").catch(() => {
      /* best effort */
    });
  }, SAVE_DEBOUNCE_MS);
}

/** Flush pending state synchronously — used on close so the final bounds
 * survive even when the app quits right after. */
function flushSync(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    writeFileSync(file(), JSON.stringify(store ?? {}, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}

export function savedBounds(label: string): Rectangle | undefined {
  return loaded()[label];
}

/** Persist this window's bounds on move/resize/close under `label`. */
export function trackWindow(win: BrowserWindow, label: string): void {
  const update = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    loaded()[label] = win.getBounds();
    scheduleSave();
  };
  win.on("resize", update);
  win.on("move", update);
  win.on("close", () => {
    update();
    flushSync();
  });
}

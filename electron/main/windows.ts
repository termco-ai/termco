/**
 * Window lifecycle: the main + settings BrowserWindows, their creation, the
 * webContents→label registry, event forwarding to the renderer, and the
 * app-global event broadcast used by the emit/listen bus.
 */
import { BrowserWindow, type WebContents } from "electron";
import { join } from "node:path";
import { savedBounds, trackWindow } from "./windowState";

const IS_MAC = process.platform === "darwin";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// Resolve paths relative to the built main bundle (dist-electron/main/index.cjs).
// __dirname is a genuine CommonJS global in the esbuild cjs output.
const PRELOAD = join(__dirname, "../preload/index.cjs");
const RENDERER_DIST = join(__dirname, "../../dist");

const windowsByLabel = new Map<string, BrowserWindow>();
const labelByWebContentsId = new Map<number, string>();

export function labelForSender(sender: WebContents): string {
  return labelByWebContentsId.get(sender.id) ?? "main";
}

export function windowByLabel(label: string): BrowserWindow | undefined {
  return windowsByLabel.get(label);
}

export function allWindows(): BrowserWindow[] {
  return [...windowsByLabel.values()].filter((w) => !w.isDestroyed());
}

/** Broadcast an app-global event to every window (the sender receives it too). */
export function broadcastEvent(event: string, payload: unknown): void {
  for (const win of allWindows()) {
    // During window teardown the webContents dies before the window leaves the
    // registry — sending then throws "Object has been destroyed", and an
    // uncaught throw inside a close handler pops Electron's modal error dialog
    // (which permanently blocks quit in headless/E2E runs).
    if (win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send("termco:event", { event, payload });
    } catch {
      // window died between the check and the send — skip it
    }
  }
}

/** Emit a backend event to a single window (fs:changed, agent-signal, …). */
export function emitToWindow(
  label: string,
  event: string,
  payload: unknown,
): void {
  const win = windowsByLabel.get(label);
  if (win && !win.isDestroyed()) {
    win.webContents.send("termco:event", { event, payload });
  }
}

/** Send a per-window lifecycle signal (focus-changed, close-requested, …). */
export function sendWindowEvent(
  win: BrowserWindow,
  name: string,
  payload: unknown,
): void {
  if (!win.isDestroyed()) {
    win.webContents.send("termco:window-event", { name, payload });
  }
}

interface CreateOptions {
  label: string;
  entry: "index";
  width?: number;
  height?: number;
  parent?: BrowserWindow;
}

/** Tracks windows the user explicitly force-closed so the close guard yields. */
const forceClosing = new Set<string>();

export function markForceClose(label: string): void {
  forceClosing.add(label);
}

// Set once the app is genuinely quitting (File→Quit, app.quit(), E2E teardown) so
// the per-window unsaved-work close guard yields instead of trapping the close.
let appIsQuitting = process.env.TERMCO_E2E === "1";

/**
 * Im E2E bleibt jedes Fenster unsichtbar.
 *
 * Playwright spricht über CDP mit dem Renderer, nicht über das Betriebssystem
 * — sichtbar muss dafür nichts sein. Sichtbar heißt nur: Bei jedem Testfall
 * springt ein Fenster auf und nimmt den Fokus, und ein Lauf über zwanzig Fälle
 * macht den Rechner unbenutzbar.
 *
 * `backgroundThrottling` muss dafür aus: Ein verstecktes Fenster bremst sonst
 * Zeitgeber und Animationsbilder, und dann werden Tests langsam und launisch —
 * ausgerechnet die, die auf Übergänge warten.
 */
export const IS_E2E = process.env.TERMCO_E2E === "1";

export function setAppQuitting(): void {
  appIsQuitting = true;
}

export function createWindow(options: CreateOptions): BrowserWindow {
  const existing = windowsByLabel.get(options.label);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const restored = savedBounds(options.label);
  const win = new BrowserWindow({
    width: restored?.width ?? options.width ?? 900,
    height: restored?.height ?? options.height ?? 640,
    x: restored?.x,
    y: restored?.y,
    minWidth: 420,
    minHeight: 280,
    show: false,
    // macOS keeps native traffic lights via an overlay titlebar; other platforms
    // render custom controls (USE_CUSTOM_WINDOW_CONTROLS in src/lib/platform.ts).
    titleBarStyle: IS_MAC ? "hiddenInset" : "hidden",
    frame: IS_MAC,
    backgroundColor: "#0d0f13",
    parent: options.parent,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: !IS_E2E,
    },
  });

  windowsByLabel.set(options.label, win);
  labelByWebContentsId.set(win.webContents.id, options.label);
  trackWindow(win, options.label);

  // Do not make window visibility depend solely on renderer IPC. A plugin
  // activation failure used to leave a healthy Electron process with a
  // permanently hidden window, which looked exactly like `pnpm run dev` had
  // hung. The renderer still asks to show after its first paint; this native
  // fallback guarantees that startup and actionable renderer errors are
  // visible even when that request never arrives.
  win.once("ready-to-show", () => {
    if (IS_E2E || win.isDestroyed()) return;
    win.show();
    win.focus();
  });

  win.on("closed", () => {
    windowsByLabel.delete(options.label);
    forceClosing.delete(options.label);
  });

  // Unsaved-work guard: defer real close, ask the renderer, let it force-close.
  // Yields once the app is quitting so File→Quit / app.quit() aren't trapped.
  win.on("close", (event) => {
    if (forceClosing.has(options.label) || appIsQuitting) return;
    event.preventDefault();
    sendWindowEvent(win, "close-requested", null);
  });

  win.on("focus", () => sendWindowEvent(win, "focus-changed", true));
  win.on("blur", () => sendWindowEvent(win, "focus-changed", false));
  win.on("resize", () => sendWindowEvent(win, "resized", null));

  const query = `?window=${options.label}`;
  if (DEV_SERVER_URL) {
    void win.loadURL(`${DEV_SERVER_URL}/${options.entry}.html${query}`);
  } else {
    void win.loadFile(join(RENDERER_DIST, `${options.entry}.html`), {
      search: query,
    });
  }

  return win;
}

/**
 * Window lifecycle: the main + settings BrowserWindows, their creation, the
 * webContents→label registry, event forwarding to the renderer, and the
 * app-global event broadcast used by the emit/listen bus.
 */
import { BrowserWindow, WebContentsView, type WebContents } from "electron";
import { join } from "node:path";
import { savedBounds, trackWindow } from "./windowState";

const IS_MAC = process.platform === "darwin";
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
// Native browser pages and the Termco UI must be sibling WebContentsViews so
// either one can be raised above the other. Keep the old BrowserWindow-hosted
// renderer only for the existing Playwright harness, which attaches directly
// to BrowserWindow.webContents.
const USE_LAYERED_RENDERER =
  process.env.TERMCO_E2E !== "1" &&
  process.env.TERMCO_DISABLE_LAYERED_RENDERER !== "1";

// Resolve paths relative to the built main bundle (dist-electron/main/index.cjs).
// __dirname is a genuine CommonJS global in the esbuild cjs output.
const PRELOAD = join(__dirname, "../preload/index.cjs");
const RENDERER_DIST = join(__dirname, "../../dist");

const windowsByLabel = new Map<string, BrowserWindow>();
const labelByWebContentsId = new Map<number, string>();
const rendererByLabel = new Map<string, WebContents>();

function rendererForWindow(win: BrowserWindow): WebContents {
  const label = [...windowsByLabel].find(([, candidate]) => candidate === win)?.[0];
  return (label && rendererByLabel.get(label)) ?? win.webContents;
}

export function labelForSender(sender: WebContents): string {
  return labelByWebContentsId.get(sender.id) ?? "main";
}

export function windowByLabel(label: string): BrowserWindow | undefined {
  return windowsByLabel.get(label);
}

export function windowForSender(sender: WebContents): BrowserWindow | undefined {
  const label = labelByWebContentsId.get(sender.id);
  return label ? windowsByLabel.get(label) : undefined;
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
    const renderer = rendererForWindow(win);
    if (renderer.isDestroyed()) continue;
    try {
      renderer.send("termco:event", { event, payload });
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
    rendererForWindow(win).send("termco:event", { event, payload });
  }
}

/** Send a per-window lifecycle signal (focus-changed, close-requested, …). */
export function sendWindowEvent(
  win: BrowserWindow,
  name: string,
  payload: unknown,
): void {
  if (!win.isDestroyed()) {
    rendererForWindow(win).send("termco:window-event", { name, payload });
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

  let renderer = win.webContents;
  let rendererView: WebContentsView | null = null;
  if (USE_LAYERED_RENDERER) {
    rendererView = new WebContentsView({
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: !IS_E2E,
      },
    });
    rendererView.setBackgroundColor("#00000000");
    const [width, height] = win.getContentSize();
    rendererView.setBounds({ x: 0, y: 0, width, height });
    win.contentView.addChildView(rendererView);
    renderer = rendererView.webContents;
  }

  windowsByLabel.set(options.label, win);
  rendererByLabel.set(options.label, renderer);
  labelByWebContentsId.set(renderer.id, options.label);
  trackWindow(win, options.label);

  // Do not make window visibility depend solely on renderer IPC. A plugin
  // activation failure used to leave a healthy Electron process with a
  // permanently hidden window, which looked exactly like `pnpm run dev` had
  // hung. The renderer still asks to show after its first paint; this native
  // fallback guarantees that startup and actionable renderer errors are
  // visible even when that request never arrives.
  const showWhenReady = () => {
    if (IS_E2E || win.isDestroyed()) return;
    win.show();
    win.focus();
  };
  if (rendererView) renderer.once("did-finish-load", showWhenReady);
  else win.once("ready-to-show", showWhenReady);

  win.on("closed", () => {
    windowsByLabel.delete(options.label);
    rendererByLabel.delete(options.label);
    labelByWebContentsId.delete(renderer.id);
    forceClosing.delete(options.label);
    if (rendererView && !renderer.isDestroyed()) renderer.close();
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
  win.on("resize", () => {
    if (rendererView) {
      const [width, height] = win.getContentSize();
      rendererView.setBounds({ x: 0, y: 0, width, height });
    }
    sendWindowEvent(win, "resized", null);
  });

  const query = `?window=${options.label}${USE_LAYERED_RENDERER ? "&liveBrowserLayer=1" : ""}`;
  if (DEV_SERVER_URL) {
    void renderer.loadURL(`${DEV_SERVER_URL}/${options.entry}.html${query}`);
  } else {
    void renderer.loadFile(join(RENDERER_DIST, `${options.entry}.html`), {
      search: query,
    });
  }

  return win;
}

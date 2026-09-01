/**
 * Main-process entry: app lifecycle, the custom asset protocol, the IPC bridge
 * endpoints (termco:init / invoke / invoke-raw / emit / window), and command
 * registration.
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { promises as fs } from "node:fs";
import { sep as pathSep } from "node:path";
import { contentTypeFor } from "./core/contentType";
import { runtimeShimSource, runtimeSpecifierFromUrl } from "./core/runtimeShim";
import {
  bootPluginRuntime,
  disposePluginRuntime,
  initialPluginBootstrapStatus,
  installInitialPluginBootstrap,
  readPluginModule,
} from "./platform/pluginRuntime";
import { dispatch, makeContext } from "./ipc";
import { registerMainLifecycle } from "./lifecycle";
import {
  createWindow,
  IS_E2E,
  labelForSender,
  markForceClose,
  setAppQuitting,
} from "./windows";

const ASSET_SCHEME = "termco-asset";
const PLUGIN_SCHEME = "termco-plugin";

// Last-resort main-process fault handlers: a main plugin (or anything else)
// throwing outside a command handler must at least be LOGGED — before these,
// such faults escaped unreported. Registering the handler also keeps the app
// alive instead of Electron's uncaught-exception dialog; for a desktop shell
// a logged, degraded session beats losing every open terminal.
process.on("uncaughtException", (err) => {
  console.error("[main] uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandled rejection:", reason);
});

// The dev orchestrator restarts Electron with SIGTERM. Convert that OS signal
// into Electron's normal quit lifecycle so renderer/native resources close
// before the process exits (instead of aborting inside a native addon).
process.once("SIGTERM", () => app.quit());

// Suppress Electron's dev-only "Insecure Content-Security-Policy" console
// warning. It's injected into every renderer (including the embedded browser
// views, which load arbitrary sites whose CSP we can't control) when the app
// is unpackaged, and disappears once packaged — pure dev noise. Set before any
// renderer spawns so they inherit it.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

// Allow E2E/tests to isolate app state (store, secrets file, window-state) into a
// throwaway directory instead of the real user profile.
if (process.env.TERMCO_USER_DATA) {
  app.setPath("userData", process.env.TERMCO_USER_DATA);
}

// Privileged so fetch()/media/streaming works from the renderer over the scheme.
protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
  {
    scheme: PLUGIN_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      // Module scripts are always fetched in CORS mode; without this flag
      // Chromium refuses cross-origin requests to custom schemes outright
      // ("only supported for protocol schemes: http, https, …") and the
      // renderer's dynamic import("termco-plugin://…") fails. Paired with
      // the ACAO header the protocol handler sends.
      corsEnabled: true,
    },
  },
]);

function osPlatformName(): string {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

// Content-Security-Policy for packaged builds: allow the asset scheme, local
// model-server ws/http, wasm eval for the ghostty terminal. Applied only when
// packaged so dev tooling/HMR is unaffected.
function applyCsp(): void {
  if (!app.isPackaged) return;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${PLUGIN_SCHEME}:`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${ASSET_SCHEME}: ${PLUGIN_SCHEME}:`,
    "font-src 'self' data:",
    `media-src 'self' blob: ${ASSET_SCHEME}: ${PLUGIN_SCHEME}:`,
    "worker-src 'self' blob:",
    `connect-src 'self' data: blob: ${ASSET_SCHEME}: ws: wss: http: https:`,
  ].join("; ");
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname).replace(/^\/+/, "/");
      const data = await fs.readFile(filePath);
      return new Response(new Uint8Array(data));
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function registerPluginProtocol(): void {
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    // Integrity-bound renderer bundles selected by the active profile tree.
    // Arbitrary cache paths are never addressable through the scheme.
    try {
      if (new URL(request.url).hostname === "__plugins") {
        const resolved = await readPluginModule(request.url);
        if (!resolved) return new Response("forbidden", { status: 403 });
        return new Response(new Uint8Array(resolved.data), {
          headers: {
            "Content-Type": contentTypeFor(resolved.filePath),
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    } catch {
      return new Response("not found", { status: 404 });
    }

    // Reserved HOST: `@termco/*` runtime shims (src/core/runtime/registry.ts).
    // Checked before the file jail — `__runtime` can never be a plugin id.
    const runtimeSpec = runtimeSpecifierFromUrl(request.url);
    if (runtimeSpec !== null) {
      const source = runtimeShimSource(runtimeSpec);
      if (!source) return new Response("forbidden", { status: 403 });
      return new Response(source, {
        // The import map's prefix mapping cannot append an extension, so the
        // type is set here rather than derived from the path.
        headers: {
          "Content-Type": "text/javascript",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("forbidden", { status: 403 });
  });
}


function registerIpcEndpoints(): void {
  // Synchronous init handshake the preload uses to populate window.__termco.
  ipcMain.on("termco:init", (event: IpcMainEvent) => {
    event.returnValue = {
      platform: osPlatformName(),
      arch: process.arch,
      name: app.getName(),
      version: app.getVersion(),
      home: app.getPath("home"),
      appConfig: app.getPath("userData"),
      appData: app.getPath("userData"),
      sep: pathSep,
      label: labelForSender(event.sender),
      e2e: process.env.TERMCO_E2E === "1",
    };
  });

  ipcMain.handle(
    "termco:invoke",
    async (
      event: IpcMainInvokeEvent,
      { cmd, payload }: { cmd: string; payload: Record<string, unknown> },
    ) => {
      return dispatch(cmd, payload, makeContext(event.sender));
    },
  );

  ipcMain.handle(
    "termco:invoke-raw",
    async (
      event: IpcMainInvokeEvent,
      {
        cmd,
        bytes,
        headers,
      }: { cmd: string; bytes: Uint8Array; headers: Record<string, string> },
    ) => {
      return dispatch(cmd, {}, makeContext(event.sender, { bytes, headers }));
    },
  );

  ipcMain.handle(
    "termco:window",
    (
      event: IpcMainInvokeEvent,
      {
        action,
        payload,
      }: { action: string; payload?: Record<string, unknown> },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return null;
      switch (action) {
        case "show":
          // Im E2E bleibt es beim Verstecken — siehe IS_E2E in windows.ts.
          if (!IS_E2E) win.show();
          return null;
        case "hide":
          win.hide();
          return null;
        case "minimize":
          win.minimize();
          return null;
        case "maximize":
          win.maximize();
          return null;
        case "unmaximize":
          win.unmaximize();
          return null;
        case "toggleMaximize":
          win.isMaximized() ? win.unmaximize() : win.maximize();
          return null;
        case "isMaximized":
          return win.isMaximized();
        case "setTitle":
          win.setTitle((payload?.title as string) ?? "");
          return null;
        case "setFocus":
          win.focus();
          return null;
        case "isFocused":
          return win.isFocused();
        case "startDragging":
          // Handled natively via -webkit-app-region on [data-drag-region].
          return null;
        case "close":
          if (payload?.force) {
            markForceClose(labelForSender(event.sender));
            win.destroy();
          } else {
            win.close();
          }
          return null;
        default:
          return null;
      }
    },
  );
}

let pluginRuntimeBoot: Promise<void> | null = null;

function ensurePluginRuntime(): Promise<void> {
  pluginRuntimeBoot ??= bootPluginRuntime().then(() => undefined);
  return pluginRuntimeBoot;
}

function registerPluginBootstrapIpc(): void {
  ipcMain.handle("termco:plugins:bootstrap:status", () =>
    initialPluginBootstrapStatus(),
  );
  ipcMain.handle("termco:plugins:bootstrap:install", async (event) => {
    const result = await installInitialPluginBootstrap((progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("termco:plugins:bootstrap:progress", progress);
      }
    });
    await ensurePluginRuntime();
    return result;
  });
}

app.whenReady().then(async () => {
  // Kein Dock-Symbol im E2E — sonst hüpft es bei jedem Testfall.
  if (IS_E2E) app.dock?.hide();
  applyCsp();
  registerAssetProtocol();
  registerPluginProtocol();
  registerIpcEndpoints();
  registerPluginBootstrapIpc();
  const bootstrap = await initialPluginBootstrapStatus();
  if (bootstrap.kind === "ready") await ensurePluginRuntime();
  createWindow({ label: "main", entry: "index", width: 1100, height: 720 });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ label: "main", entry: "index", width: 1100, height: 720 });
    }
  });
});

registerMainLifecycle(app, {
  setAppQuitting,
  disposePluginRuntime,
  reportError: (error) => console.error("[main] plugin runtime teardown failed:", error),
});

app.on("window-all-closed", () => {
  // macOS keeps the app alive when all windows close — except under E2E, where
  // Playwright's teardown needs the process to actually exit.
  if (process.platform !== "darwin" || process.env.TERMCO_E2E === "1")
    app.quit();
});

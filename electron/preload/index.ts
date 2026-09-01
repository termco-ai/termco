/**
 * Preload: the single trusted boundary between the renderer and the main
 * process. Exposes `window.__termco` (the TermcoBridge contract the shims import),
 * with context isolation ON. Nothing else is exposed to the page.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  type CapabilityWireResult,
  unwrapCapabilityResult,
} from "../../src/platform/capabilityWire";
import type {
  RendererProfileChange,
  RendererProfileChangeResult,
} from "../../src/platform/rendererBootstrap";
import type { CapabilityCall } from "../../src/platform/remoteCapabilities";

interface InitData {
  platform: string;
  arch: string;
  name: string;
  version: string;
  home: string;
  appConfig: string;
  appData: string;
  sep: string;
  label: string;
  /** True when the app was launched by the E2E harness (TERMCO_E2E=1). */
  e2e: boolean;
}

// Synchronous handshake so path/os/app shims can resolve values without a Promise.
const init = ipcRenderer.sendSync("termco:init") as InitData;
let rendererGeneration: string | null = null;

type RendererCapabilityCall = Omit<CapabilityCall, "rendererGeneration"> & {
  rendererGeneration?: string;
};

async function capabilityCallWire(
  call: RendererCapabilityCall,
): Promise<CapabilityWireResult> {
  const generation = call.rendererGeneration ?? rendererGeneration;
  if (!generation) {
    return {
      ok: false,
      error: {
        name: "Error",
        message: "renderer capability generation is not initialized",
      },
    };
  }
  return await ipcRenderer.invoke(
    "termco:services:call",
    { ...call, rendererGeneration: generation },
  ) as CapabilityWireResult;
}

// ---- streaming channels (PTY data/exit, AI stream) ------------------------
const channelHandlers = new Map<number, (msg: unknown) => void>();
let channelSeq = 0;
ipcRenderer.on("termco:channel", (_e, id: number, msg: unknown) => {
  channelHandlers.get(id)?.(msg);
});

// ---- app-global event bus (emit/listen; termco://*, fs:changed, …) ---------
const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
ipcRenderer.on(
  "termco:event",
  (_e, message: { event: string; payload: unknown }) => {
    const set = eventHandlers.get(message.event);
    if (set) for (const cb of set) cb(message.payload);
  },
);

// ---- per-window lifecycle signals (focus/close-requested/drag-drop) -------
const windowEventHandlers = new Map<string, Set<(payload: unknown) => void>>();
ipcRenderer.on(
  "termco:window-event",
  (_e, message: { name: string; payload: unknown }) => {
    const set = windowEventHandlers.get(message.name);
    if (set) for (const cb of set) cb(message.payload);
  },
);

const bridge = {
  async rendererPluginProfile() {
    const profile = await ipcRenderer.invoke(
      "termco:plugins:renderer-profile",
    ) as import("../../src/platform/rendererBootstrap").RendererBootstrapData;
    rendererGeneration = profile.generation;
    return profile;
  },
  onRendererPluginProfileChanged(
    callback: (
      change: RendererProfileChange,
    ) => RendererProfileChangeResult | Promise<RendererProfileChangeResult>,
  ): () => void {
    let replacementTail = Promise.resolve();
    const listener = (
      _event: Electron.IpcRendererEvent,
      message: { requestId: string; change: RendererProfileChange },
    ) => {
      const operation = replacementTail.then(async (): Promise<RendererProfileChangeResult> => {
        const requestedGeneration = message.change.profile.generation;
        if (
          message.change.phase === "quiesce" &&
          rendererGeneration !== requestedGeneration
        ) {
          return {
            ok: false,
            generation: rendererGeneration ?? requestedGeneration,
            error: `renderer quiesce generation ${requestedGeneration} does not match active generation ${String(rendererGeneration)}`,
          };
        }
        try {
          const result = await callback(message.change);
          rendererGeneration = result.generation;
          return result;
        } catch (error) {
          return {
            ok: false,
            generation: rendererGeneration ?? requestedGeneration,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      });
      replacementTail = operation.then(
        () => undefined,
        () => undefined,
      );
      operation.then((result) =>
        ipcRenderer.send("termco:plugins:renderer-profile-change-result", {
          requestId: message.requestId,
          ...result,
        }),
      );
    };
    ipcRenderer.on("termco:plugins:renderer-profile-change", listener);
    return () =>
      ipcRenderer.removeListener(
        "termco:plugins:renderer-profile-change",
        listener,
      );
  },
  onRendererPluginImpactRequested(
    callback: (
      pluginId: string,
    ) =>
      | import("../../src/platform/runtime").PluginRemovalImpact
      | Promise<import("../../src/platform/runtime").PluginRemovalImpact>,
  ): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: { requestId: string; pluginId: string },
    ) => {
      void Promise.resolve(callback(request.pluginId)).then(
        (impact) =>
          ipcRenderer.send("termco:plugins:renderer-impact-result", {
            requestId: request.requestId,
            ok: true,
            impact,
          }),
        (error) =>
          ipcRenderer.send("termco:plugins:renderer-impact-result", {
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
    };
    ipcRenderer.on("termco:plugins:renderer-impact", listener);
    return () =>
      ipcRenderer.removeListener("termco:plugins:renderer-impact", listener);
  },
  copyAndReplacePlugin(planId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:copy-and-replace", planId);
  },
  applyPlugin(pluginId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:apply", pluginId);
  },
  undoPluginCompletion(completionId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:undo", completionId);
  },
  uninstallPlugin(pluginId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:uninstall", pluginId);
  },
  previewPluginEnabled(pluginId: string, enabled: boolean): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:preview-set-enabled", {
      pluginId,
      enabled,
    });
  },
  setPluginEnabled(
    pluginId: string,
    enabled: boolean,
    confirmation: { previewId: string; generation: number },
  ): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:set-enabled", {
      pluginId,
      enabled,
      confirmation,
    });
  },
  installPluginFromFolder(): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:install-from-folder");
  },
  openPluginsFolder(): Promise<{ path: string }> {
    return ipcRenderer.invoke("termco:plugins:open-folder");
  },
  openPluginFolder(pluginId: string): Promise<{ path: string }> {
    return ipcRenderer.invoke("termco:plugins:open-plugin-folder", pluginId);
  },
  activateProfile(profileId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:activate-profile", profileId);
  },
  profileSnapshot(): Promise<unknown> {
    return ipcRenderer.invoke("termco:profiles:snapshot");
  },
  exportProfile(request: import("../../plugin-repository/plugins/profile-base/src/profileApi").ProfileExportRequest): Promise<unknown> {
    return ipcRenderer.invoke("termco:profiles:export", request);
  },
  importProfile(): Promise<unknown> {
    return ipcRenderer.invoke("termco:profiles:import");
  },
  pluginBootstrapStatus(): Promise<import("../../src/platform/pluginBootstrap").PluginBootstrapStatus> {
    return ipcRenderer.invoke("termco:plugins:bootstrap:status");
  },
  installPluginBootstrap(): Promise<import("../../src/platform/pluginBootstrap").PluginBootstrapResult> {
    return ipcRenderer.invoke("termco:plugins:bootstrap:install");
  },
  onPluginBootstrapProgress(
    callback: (progress: import("../../src/platform/pluginBootstrap").PluginBootstrapProgress) => void,
  ): () => void {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: import("../../src/platform/pluginBootstrap").PluginBootstrapProgress,
    ) => callback(progress);
    ipcRenderer.on("termco:plugins:bootstrap:progress", listener);
    return () =>
      ipcRenderer.removeListener("termco:plugins:bootstrap:progress", listener);
  },
  checkPluginReleases(): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:releases:check");
  },
  installPluginRelease(releaseId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:releases:install", releaseId);
  },
  recoverRendererProfile(request: {
    requestedProfileId: string;
    message: string;
  }): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:recover-renderer", request);
  },
  listPluginSourceFiles(pluginId: string): Promise<string[]> {
    return ipcRenderer.invoke("termco:plugins:list-source-files", pluginId);
  },
  listPluginDrafts(): Promise<import("@termco/profile-base").PluginDraftItem[]> {
    return ipcRenderer.invoke("termco:plugins:list-drafts");
  },
  planPlugin(
    request: import("@termco/profile-base").PluginAuthoringPlanRequest,
  ): Promise<import("@termco/profile-base").PluginAuthoringPlanResult> {
    return ipcRenderer.invoke("termco:plugins:plan", request);
  },
  readPluginSourceFile(pluginId: string, relativePath: string): Promise<string> {
    return ipcRenderer.invoke("termco:plugins:read-source-file", {
      pluginId,
      relativePath,
    });
  },
  writePluginSourceFile(
    pluginId: string,
    relativePath: string,
    content: string,
  ): Promise<void> {
    return ipcRenderer.invoke("termco:plugins:write-source-file", {
      pluginId,
      relativePath,
      content,
    });
  },
  createPlugin(planId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:create", planId);
  },
  forkPlugin(planId: string): Promise<unknown> {
    return ipcRenderer.invoke("termco:plugins:fork", planId);
  },
  capabilityCallWire,
  async capabilityCall(call: RendererCapabilityCall): Promise<unknown> {
    return unwrapCapabilityResult(await capabilityCallWire(call));
  },
  invoke(cmd: string, payload: unknown): Promise<unknown> {
    return ipcRenderer.invoke("termco:invoke", { cmd, payload });
  },
  invokeRaw(
    cmd: string,
    bytes: Uint8Array,
    headers: Record<string, string>,
  ): Promise<unknown> {
    return ipcRenderer.invoke("termco:invoke-raw", { cmd, bytes, headers });
  },
  registerChannel(onMessage: (msg: unknown) => void): number {
    const id = ++channelSeq;
    channelHandlers.set(id, onMessage);
    return id;
  },
  releaseChannel(id: number): void {
    channelHandlers.delete(id);
  },
  emit(event: string, payload: unknown): Promise<void> {
    return ipcRenderer.invoke("termco:emit", {
      event,
      payload,
    }) as Promise<void>;
  },
  listen(event: string, cb: (payload: unknown) => void): () => void {
    let set = eventHandlers.get(event);
    if (!set) {
      set = new Set();
      eventHandlers.set(event, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  },
  windowAction(action: string, payload?: unknown): Promise<unknown> {
    return ipcRenderer.invoke("termco:window", { action, payload });
  },
  onWindowEvent(name: string, cb: (payload: unknown) => void): () => void {
    let set = windowEventHandlers.get(name);
    if (!set) {
      set = new Set();
      windowEventHandlers.set(name, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  },
  os: { platform: init.platform, arch: init.arch },
  appInfo: { name: init.name, version: init.version },
  paths: {
    home: init.home,
    appConfig: init.appConfig,
    appData: init.appData,
    sep: init.sep,
  },
  label: init.label,
  e2e: init.e2e,
};

contextBridge.exposeInMainWorld("__termco", bridge);

// `[data-drag-region]` marks titlebar surfaces as window-drag handles via CSS
// app-region; inject the rules (interactive children opt back out) to keep the
// custom titlebar draggable.
function injectDragRegionStyles(): void {
  const style = document.createElement("style");
  style.textContent = `
    [data-drag-region] { -webkit-app-region: drag; }
    [data-drag-region] :is(button,a,input,select,textarea,label,[role="button"],[role="tab"]) {
      -webkit-app-region: no-drag;
    }
    /* Floating overlays (portaled menus/dialogs, the fixed AI popup) render at the
       document root, NOT inside the titlebar, so the rule above never reaches them.
       Draggable regions are computed geometrically — z-index does NOT carve out an
       overlapping element — so any overlay sitting over the titlebar has its clicks
       eaten by the native window-drag. Opt every floating surface back out. */
    [data-ai-mini-window],
    [data-radix-popper-content-wrapper],
    [role="dialog"],
    [role="menu"],
    [role="listbox"],
    [role="tooltip"] {
      -webkit-app-region: no-drag;
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectDragRegionStyles, {
    once: true,
  });
} else {
  injectDragRegionStyles();
}

// Bridge native file drops to `drag-drop` window-events, so the
// frontend's getCurrentWebview().onDragDropEvent(...) keeps working. File paths
// come from webUtils.getPathForFile (the Electron-sanctioned API).
function dispatchDragDrop(payload: unknown): void {
  const set = windowEventHandlers.get("drag-drop");
  if (set) for (const cb of set) cb(payload);
}

function filePaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const out: string[] = [];
  for (const item of Array.from(dt.files)) {
    try {
      const p = webUtils.getPathForFile(item);
      if (p) out.push(p);
    } catch {
      /* not a real file */
    }
  }
  return out;
}

let dragActive = false;
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  const position = { x: e.clientX, y: e.clientY };
  if (!dragActive) {
    dragActive = true;
    dispatchDragDrop({
      type: "enter",
      paths: filePaths(e.dataTransfer),
      position,
    });
  }
  dispatchDragDrop({ type: "over", position });
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragActive = false;
  dispatchDragDrop({
    type: "drop",
    paths: filePaths(e.dataTransfer),
    position: { x: e.clientX, y: e.clientY },
  });
});
window.addEventListener("dragleave", (e) => {
  if (e.relatedTarget === null) {
    dragActive = false;
    dispatchDragDrop({ type: "leave" });
  }
});

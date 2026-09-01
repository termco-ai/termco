/**
 * The single window-global the preload script exposes. Every module in this
 * directory talks to Electron exclusively through this interface, so the surface
 * exposed across the context-isolation boundary stays small and auditable.
 */
export interface TermcoBridge {
  /** Generic process-transport wire call. Renderer code unwraps the fulfilled
   * envelope after context isolation so typed provider error codes survive. */
  capabilityCallWire(call: {
    consumerPluginId: string;
    capability: string;
    method: string;
    args: unknown[];
    /** Append caller identity authenticated by Electron's IPC event. */
    caller?: boolean;
    callerFields?: Record<string, unknown>;
  }): Promise<import("../platform/capabilityWire").CapabilityWireResult>;
  /** Test/developer convenience facade over capabilityCallWire. Product
   * process proxies use the fulfilled wire method above. */
  capabilityCall(call: {
    consumerPluginId: string;
    capability: string;
    method: string;
    args: unknown[];
    /** Append caller identity authenticated by Electron's IPC event. */
    caller?: boolean;
    callerFields?: Record<string, unknown>;
  }): Promise<unknown>;
  /** Locked renderer projection and integrity-bound module URLs. */
  rendererPluginProfile(): Promise<
    import("../platform/rendererBootstrap").RendererBootstrapData
  >;
  /** Subscribe to an atomic renderer graph replacement requested by main. */
  onRendererPluginProfileChanged(
    callback: (
      change: import("../platform/rendererBootstrap").RendererProfileChange,
    ) =>
      | import("../platform/rendererBootstrap").RendererProfileChangeResult
      | Promise<
          import("../platform/rendererBootstrap").RendererProfileChangeResult
        >,
  ): () => void;
  /** Answer an impact-preview request from the active renderer runtime. */
  onRendererPluginImpactRequested(
    callback: (
      pluginId: string,
    ) =>
      | import("../platform/runtime").PluginRemovalImpact
      | Promise<import("../platform/runtime").PluginRemovalImpact>,
  ): () => void;
  listPluginSourceFiles(pluginId: string): Promise<string[]>;
  listPluginDrafts(): Promise<import("@termco/profile-base").PluginDraftItem[]>;
  planPlugin(
    request: import("@termco/profile-base").PluginAuthoringPlanRequest,
  ): Promise<import("@termco/profile-base").PluginAuthoringPlanResult>;
  readPluginSourceFile(pluginId: string, relativePath: string): Promise<string>;
  writePluginSourceFile(
    pluginId: string,
    relativePath: string,
    content: string,
  ): Promise<void>;
  /** Scaffold and compile an independent managed draft without activating it. */
  createPlugin(planId: string): Promise<import("@termco/profile-base").PluginCreateResult>;
  /** Copy a selected source into a new independent managed plugin. */
  forkPlugin(planId: string): Promise<import("@termco/profile-base").PluginForkResult>;
  /** Copy the complete active source folder into an isolated replacement
   * draft. Applying the final draft owns validation, rollback, and commit. */
  copyAndReplacePlugin(planId: string): Promise<import("@termco/profile-base").PluginMutationResult>;
  /** Compile and transactionally apply a managed draft or active source edit. */
  applyPlugin(
    pluginId: string,
  ): Promise<import("@termco/profile-base").PluginMutationResult>;
  undoPluginCompletion(
    completionId: string,
  ): Promise<import("@termco/profile-base").PluginUndoResult>;
  /** Disable an installed user plugin and move its source folder to Trash. */
  uninstallPlugin(pluginId: string): Promise<{
    status: "uninstalled" | "cancelled";
    pluginId: string;
    sourceFolder: string;
    movedToTrash: boolean;
    warning?: { message: string };
  }>;
  /** Preview dependency and resource consequences without mutating the graph. */
  previewPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<import("@termco/profile-base").PluginDisableImpact>;
  /** Enable or disable a selected profile row through an atomic live update. */
  setPluginEnabled(
    pluginId: string,
    enabled: boolean,
    confirmation: import("@termco/profile-base").PluginEnableConfirmation,
  ): Promise<{
    status: "replaced" | "cancelled";
    pluginId: string;
    enabled: boolean;
    warning?: { message: string };
  }>;
  /** Choose a plugin directory and copy it into the managed plugin root. */
  installPluginFromFolder(): Promise<{
    status: "installed" | "cancelled";
    pluginId?: string;
    sourceFolder?: string;
    warning?: { message: string };
  }>;
  /** Ensure the managed plugin root exists and reveal it in the OS. */
  openPluginsFolder(): Promise<{ path: string }>;
  /** Reveal one exact selected plugin or managed draft source directory. */
  openPluginFolder(pluginId: string): Promise<{ path: string }>;
  /** Activate a named profile through the same atomic live transaction. */
  activateProfile(profileId: string): Promise<{
    status: "replaced" | "cancelled";
    profileId: string;
    warning?: { message: string };
  }>;
  profileSnapshot(): Promise<import("@termco/profile-base").ProfileManagementSnapshot>;
  exportProfile(
    request: import("@termco/profile-base").ProfileExportRequest,
  ): Promise<import("@termco/profile-base").ProfileExportResult>;
  importProfile(): Promise<import("@termco/profile-base").ProfileImportResult>;
  /** Report whether the signed first-run plugin set has been installed. */
  pluginBootstrapStatus(): Promise<import("../platform/pluginBootstrap").PluginBootstrapStatus>;
  /** Download, verify, compile, and activate the initial official plugin set. */
  installPluginBootstrap(): Promise<import("../platform/pluginBootstrap").PluginBootstrapResult>;
  /** Observe first-run setup stages while the main process owns installation. */
  onPluginBootstrapProgress(
    callback: (progress: import("../platform/pluginBootstrap").PluginBootstrapProgress) => void,
  ): () => void;
  /** Check the separately signed stable plugin-release feed. */
  checkPluginReleases(): Promise<unknown>;
  /** Install a previously checked and user-confirmed atomic plugin set. */
  installPluginRelease(releaseId: string): Promise<unknown>;
  /** Recover a renderer that failed before the plugin-owned shell mounted. */
  recoverRendererProfile(request: {
    requestedProfileId: string;
    message: string;
  }): Promise<{ status: "replaced"; profileId: string }>;
  /** Structured-clone RPC: resolves with the command's return value. */
  invoke(cmd: string, payload: unknown): Promise<unknown>;
  /** Raw-bytes fast path (used by pty_write) — no JSON round-trip per keystroke. */
  invokeRaw(
    cmd: string,
    bytes: Uint8Array,
    headers: Record<string, string>,
  ): Promise<unknown>;
  /** Register a streaming channel sink; returns the id passed to the main process. */
  registerChannel(onMessage: (msg: unknown) => void): number;
  releaseChannel(id: number): void;
  /** Fire an app-global event (broadcast to every window, including this one). */
  emit(event: string, payload: unknown): Promise<void>;
  /** Subscribe to an event; returns an unlisten fn. */
  listen(event: string, cb: (payload: unknown) => void): () => void;
  /** Window-control RPC (show/hide/minimize/close/setTitle/…). */
  windowAction(action: string, payload?: unknown): Promise<unknown>;
  /** Subscribe to a window lifecycle signal (focus/blur/close-requested/drag-drop). */
  onWindowEvent(name: string, cb: (payload: unknown) => void): () => void;
  /** Synchronous platform facts, resolved once in preload. */
  os: { platform: string; arch: string };
  appInfo: { name: string; version: string };
  /** Base directories, resolved once in preload. */
  paths: {
    home: string;
    appConfig: string;
    appData: string;
    sep: string;
  };
  /** This window's platform-assigned label. */
  label: string;
  /** True when launched by the E2E harness (TERMCO_E2E=1); gates test seams. */
  e2e?: boolean;
}

declare global {
  interface Window {
    __termco: TermcoBridge;
  }
}

export function bridge(): TermcoBridge {
  const b = (globalThis as unknown as { __termco?: TermcoBridge }).__termco;
  if (!b) {
    throw new Error(
      "Termco bridge unavailable — preload script did not run. " +
        "This module must run inside the Electron renderer.",
    );
  }
  return b;
}

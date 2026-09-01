import type { ResolvedPluginTree } from "./contracts";
import type { CapabilityRuntime } from "./runtime";

/** Kernel-owned service injected into explicit cross-process bridge Fibers.
 * Its value is bound to the receiving plugin identity by the runtime. */
export const processTransportService = "kernel.process-transport" as const;

/** Generic process proxies intentionally do not pretend to expose a local,
 * synchronously-disposable observable. Callback services own explicit bridges. */
export const processServiceProxyMarker = Symbol.for(
  "termco.kernel.process-service-proxy",
);

export interface CapabilityCall {
  consumerPluginId: string;
  /** Host-issued identity captured by the installed kernel ProcessTransport. */
  rendererGeneration?: string;
  capability: string;
  method: string;
  args: unknown[];
  caller?: boolean;
  callerFields?: Record<string, unknown>;
}

export type ProcessChannelListener = {
  bivarianceHack(...messages: unknown[]): void;
}["bivarianceHack"];

export type CapabilityTransport = ((
  call: CapabilityCall,
) => Promise<unknown>) & {
  registerChannel?(listener: ProcessChannelListener): number;
  releaseChannel?(channelId: number): void;
  subscribeHostEvent?(
    name: string,
    listener: ProcessChannelListener,
  ): () => void;
};
export interface ProcessChannel {
  readonly __termcoChannel: number;
}
export interface ProcessCallOptions {
  readonly caller?: boolean;
  readonly callerFields?: Readonly<Record<string, unknown>>;
}
export interface ProcessRemoteDispose {
  readonly __termcoDispose: string;
}
export interface ProcessHostControl {
  catalog(): readonly unknown[];
  subscribe(listener: () => void): () => void;
  listPluginDrafts(): Promise<unknown>;
  planPlugin(request: unknown): Promise<unknown>;
  listSourceFiles(pluginId: string): Promise<string[]>;
  readSourceFile(pluginId: string, relativePath: string): Promise<string>;
  writeSourceFile(
    pluginId: string,
    relativePath: string,
    content: string,
  ): Promise<void>;
  createPlugin(planId: string): Promise<unknown>;
  forkPlugin(planId: string): Promise<unknown>;
  copyAndReplace(planId: string): Promise<unknown>;
  apply(pluginId: string): Promise<unknown>;
  undoPluginCompletion(completionId: string): Promise<unknown>;
  uninstall(pluginId: string): Promise<unknown>;
  previewSetEnabled(pluginId: string, enabled: boolean): Promise<unknown>;
  setEnabled(
    pluginId: string,
    enabled: boolean,
    confirmation: { previewId: string; generation: number },
  ): Promise<unknown>;
  installFromFolder(): Promise<unknown>;
  openPluginsFolder(): Promise<unknown>;
  openPluginFolder(pluginId: string): Promise<unknown>;
  activateProfile(profileId: string): Promise<unknown>;
  profileSnapshot(): Promise<unknown>;
  exportProfile(request: unknown): Promise<unknown>;
  importProfile(): Promise<unknown>;
  checkPluginReleases?(): Promise<unknown>;
  installPluginRelease?(releaseId: string): Promise<unknown>;
}
export interface ProcessTransport {
  readonly hostControl?: ProcessHostControl;
  call(
    service: string,
    method: string,
    args: readonly unknown[],
    options?: ProcessCallOptions,
  ): Promise<unknown>;
  registerChannel(listener: ProcessChannelListener): ProcessChannel;
  releaseChannel(channel: ProcessChannel): void;
  releaseRemote(dispose: ProcessRemoteDispose): Promise<void>;
  subscribeHostEvent?(
    name: string,
    listener: ProcessChannelListener,
  ): () => void;
}

/** Generic process transport. The tree authenticates only the calling plugin
 * identity; executable `inject` metadata and live service availability replace
 * the removed central permission and capability catalogues. */
export class CapabilityRpcRouter {
  constructor(
    readonly tree: ResolvedPluginTree,
    readonly providerRuntime: CapabilityRuntime,
  ) {}

  async dispatch(call: CapabilityCall): Promise<unknown> {
    const consumer = this.tree.plugins.some(
      (plugin) => plugin.id === call.consumerPluginId,
    );
    if (!consumer) {
      throw new Error(`unknown service consumer "${call.consumerPluginId}"`);
    }
    return this.providerRuntime.callCapability(
      call.capability,
      call.method,
      call.args,
    );
  }
}

export function bindProcessTransport(
  consumerPluginId: string,
  transport: CapabilityTransport,
  hostControl?: ProcessHostControl,
  rendererGeneration?: string,
): ProcessTransport {
  return {
    ...(hostControl ? { hostControl } : {}),
    call(service, method, args, options) {
      if (options?.callerFields && !options.caller) {
        throw new Error("callerFields require authenticated caller metadata");
      }
      return transport({
        consumerPluginId,
        ...(rendererGeneration ? { rendererGeneration } : {}),
        capability: service,
        method,
        args: [...args],
        ...(options?.caller ? { caller: true } : {}),
        ...(options?.callerFields
          ? { callerFields: { ...options.callerFields } }
          : {}),
      });
    },
    registerChannel(listener) {
      const channelId = transport.registerChannel?.(listener);
      if (!Number.isInteger(channelId)) {
        throw new Error("process transport does not support callback channels");
      }
      return { __termcoChannel: channelId as number };
    },
    releaseChannel(channel) {
      if (!transport.releaseChannel) {
        throw new Error("process transport does not support channel cleanup");
      }
      transport.releaseChannel(channel.__termcoChannel);
    },
    async releaseRemote(dispose) {
      await transport({
        consumerPluginId,
        ...(rendererGeneration ? { rendererGeneration } : {}),
        capability: processTransportService,
        method: "release",
        args: [dispose],
      });
    },
    subscribeHostEvent(name, listener) {
      if (!transport.subscribeHostEvent) {
        throw new Error("process transport does not support host events");
      }
      return transport.subscribeHostEvent(name, listener);
    },
  };
}

/** Build a service-family proxy without teaching the kernel its methods. */
export function createProcessServiceProxy<T extends object>(
  service: string,
  transport: ProcessTransport,
  options?: ProcessCallOptions,
): T {
  return new Proxy(Object.create(null) as T, {
    get(_target, property) {
      if (property === processServiceProxyMarker) return true;
      if (typeof property !== "string" || property === "then") return undefined;
      return (...args: unknown[]) =>
        options
          ? transport.call(service, property, args, options)
          : transport.call(service, property, args);
    },
  });
}

/** Install the one product-neutral bridge primitive. Product services are
 * provided only by explicit family bridge Fibers. */
export function installProcessServices(
  localRuntime: CapabilityRuntime,
  transport: CapabilityTransport,
  hostControl?: ProcessHostControl,
  rendererGeneration?: string,
): () => void {
  return localRuntime.installExternalCapabilityFactory(
    processTransportService,
    "kernel",
    (consumerPluginId) =>
      bindProcessTransport(
        consumerPluginId,
        transport,
        hostControl,
        rendererGeneration,
      ),
  );
}

import type { ResolvedPluginTree } from "./contracts";
import { LiveGraphController } from "./liveReplacement";
import { projectPluginTree } from "./processGraph";
import {
  type CapabilityTransport,
  installProcessServices,
  type ProcessHostControl,
} from "./remoteCapabilities";
import { CapabilityRuntime, type PluginModule } from "./runtime";

export interface RendererPluginModuleDescriptor {
  pluginId: string;
  version: string;
  integrity: string;
  url: string;
}

/** Structured-clone-safe renderer projection returned by the trusted main
 * process. It contains only ordered package rows, module locations, and
 * product-neutral catalog data, never a central service graph. */
export interface RendererBootstrapData {
  /** Opaque host-issued identity for one renderer runtime generation. */
  generation: string;
  profileId: string;
  plugins: ResolvedPluginTree["plugins"];
  activationOrder: string[];
  modules: RendererPluginModuleDescriptor[];
  catalog: unknown[];
}

export type RendererProfileChange =
  | {
      phase: "quiesce";
      profile: RendererBootstrapData;
      changedPluginIds: string[];
      changedServiceNames: string[];
    }
  | {
      phase: "activate";
      profile: RendererBootstrapData;
      changedServiceNames: string[];
    };

/** The renderer runtime reports the transport epoch it actually retained.
 * Candidate failure may restore previous code on the candidate epoch. */
export type RendererProfileChangeResult =
  | { ok: true; generation: string }
  | { ok: false; generation: string; error: string };

export interface ActiveRendererProfile {
  tree: ResolvedPluginTree;
  processTree: ResolvedPluginTree;
  runtime: CapabilityRuntime;
  controller: LiveGraphController;
  catalog: unknown[];
  removeProcessServices(): void;
  dispose(): Promise<void>;
}

export function serializeRendererBootstrap(input: {
  tree: ResolvedPluginTree;
  modules: RendererPluginModuleDescriptor[];
  catalog?: unknown[];
  generation?: string;
}): RendererBootstrapData {
  return {
    generation: input.generation ?? "renderer-unassigned",
    profileId: input.tree.profileId,
    plugins: input.tree.plugins,
    activationOrder: input.tree.activationOrder,
    modules: input.modules,
    catalog: input.catalog ?? [],
  };
}

export function deserializeRendererTree(
  data: RendererBootstrapData,
): ResolvedPluginTree {
  return {
    profileId: data.profileId,
    plugins: data.plugins,
    activationOrder: data.activationOrder,
  };
}

async function importRendererModule(url: string): Promise<PluginModule> {
  const imported = (await import(/* @vite-ignore */ url)) as {
    default?: PluginModule;
  };
  if (!imported.default || typeof imported.default.activate !== "function") {
    throw new Error(`renderer plugin at ${url} must default-export activate()`);
  }
  return imported.default;
}

/** Activate the renderer projection selected by main. Loaded modules declare
 * their own dependencies; explicit family bridge Fibers project remote
 * services through the product-neutral process transport. */
export async function activateRendererProfile(input: {
  data: RendererBootstrapData;
  transport: CapabilityTransport;
  hostControl?: ProcessHostControl;
  loadModule?: (
    descriptor: RendererPluginModuleDescriptor,
  ) => Promise<PluginModule>;
}): Promise<ActiveRendererProfile> {
  const tree = deserializeRendererTree(input.data);
  const processTree = projectPluginTree(tree, "renderer");
  const runtime = new CapabilityRuntime(processTree);
  const byId = new Map(
    input.data.modules.map((descriptor) => [descriptor.pluginId, descriptor]),
  );
  const load =
    input.loadModule ??
    ((descriptor: RendererPluginModuleDescriptor) =>
      importRendererModule(descriptor.url));
  const modules = new Map<string, PluginModule>();
  for (const pluginId of processTree.activationOrder) {
    const descriptor = byId.get(pluginId);
    if (!descriptor) {
      throw new Error(
        `renderer module descriptor for "${pluginId}" is missing`,
      );
    }
    modules.set(pluginId, await load(descriptor));
  }
  const removeProcessServices = installProcessServices(
    runtime,
    input.transport,
    input.hostControl,
    input.data.generation,
  );

  try {
    await runtime.activateGraph(async (pluginId) => {
      const module = modules.get(pluginId);
      if (!module) {
        throw new Error(`renderer module for "${pluginId}" is missing`);
      }
      return module;
    });
  } catch (error) {
    removeProcessServices();
    throw error;
  }

  let disposed = false;
  const controller = new LiveGraphController(runtime);
  return {
    tree,
    processTree,
    runtime,
    controller,
    catalog: input.data.catalog,
    removeProcessServices,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await controller.runtime.disposeAll();
      removeProcessServices();
    },
  };
}

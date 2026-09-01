import { bridge } from "../native/bridge";
import {
  overlayRuntimeCatalog,
  type RuntimePluginCatalogItem,
} from "./catalog";
import { electronCapabilityTransport } from "./electronTransport";
import { changedPluginIds } from "./liveReplacement";
import { projectPluginTree } from "./processGraph";
import {
  installProcessServices,
  type ProcessHostControl,
  processTransportService,
} from "./remoteCapabilities";
import {
  type ActiveRendererProfile,
  activateRendererProfile,
  deserializeRendererTree,
  type RendererBootstrapData,
  type RendererPluginModuleDescriptor,
  type RendererProfileChange,
  type RendererProfileChangeResult,
} from "./rendererBootstrap";
import { CapabilityRuntime, type PluginModule } from "./runtime";

type E2EReplacementRequest = {
  readonly pluginId: string;
  readonly replacementId: string;
  readonly name?: string;
  readonly target?: import("@termco/profile-base").PluginCreationTarget;
};

type E2EAuthoringSeam = Record<string, unknown> & {
  copyAndReplacePluginThroughPlan?: (
    request: E2EReplacementRequest,
  ) => Promise<import("@termco/profile-base").PluginMutationResult>;
};

let active: Promise<ActiveRendererProfile> | null = null;
let current: ActiveRendererProfile | null = null;
let activeData: RendererBootstrapData | null = null;
let removeReplacementListener: (() => void) | null = null;
let removeImpactListener: (() => void) | null = null;
let quiescedTransaction: {
  profileId: string;
  allowPendingPluginIds: ReadonlySet<string>;
} | null = null;
const listeners = new Set<() => void>();
const hostControlListeners = new Set<() => void>();

const hostControl: ProcessHostControl = {
  catalog: () => activeData?.catalog ?? [],
  subscribe(listener) {
    hostControlListeners.add(listener);
    return () => hostControlListeners.delete(listener);
  },
  listPluginDrafts: () => bridge().listPluginDrafts(),
  planPlugin: (request) => bridge().planPlugin(
    request as Parameters<ReturnType<typeof bridge>["planPlugin"]>[0],
  ),
  listSourceFiles: (pluginId) => bridge().listPluginSourceFiles(pluginId),
  readSourceFile: (pluginId, relativePath) =>
    bridge().readPluginSourceFile(pluginId, relativePath),
  writeSourceFile: (pluginId, relativePath, content) =>
    bridge().writePluginSourceFile(pluginId, relativePath, content),
  createPlugin: (planId) => bridge().createPlugin(planId),
  forkPlugin: (planId) => bridge().forkPlugin(planId),
  copyAndReplace: (planId) => bridge().copyAndReplacePlugin(planId),
  apply: (pluginId) => bridge().applyPlugin(pluginId),
  undoPluginCompletion: (completionId) =>
    bridge().undoPluginCompletion(completionId),
  uninstall: (pluginId) => bridge().uninstallPlugin(pluginId),
  previewSetEnabled: (pluginId, enabled) =>
    bridge().previewPluginEnabled(pluginId, enabled),
  setEnabled: (pluginId, enabled, confirmation) =>
    bridge().setPluginEnabled(pluginId, enabled, confirmation),
  installFromFolder: () => bridge().installPluginFromFolder(),
  openPluginsFolder: () => bridge().openPluginsFolder(),
  openPluginFolder: (pluginId) => bridge().openPluginFolder(pluginId),
  activateProfile: (profileId) => bridge().activateProfile(profileId),
  profileSnapshot: () => bridge().profileSnapshot(),
  exportProfile: (request) => bridge().exportProfile(
    request as Parameters<ReturnType<typeof bridge>["exportProfile"]>[0],
  ),
  importProfile: () => bridge().importProfile(),
  checkPluginReleases: () => bridge().checkPluginReleases(),
  installPluginRelease: (releaseId) => bridge().installPluginRelease(releaseId),
};

/** Install test-only authoring conveniences over the production contract.
 * Manual Electron E2Es do not use the shared Playwright page fixture, so this
 * seam must live with the renderer runtime. It is never published in normal
 * application launches and deliberately does not restore a legacy bridge
 * mutation signature. */
function installE2EAuthoringSeam(): void {
  const api = bridge();
  if (!api.e2e) return;
  const host = globalThis as typeof globalThis & {
    __termcoE2E?: E2EAuthoringSeam;
  };
  const seam = (host.__termcoE2E ??= {});
  seam.copyAndReplacePluginThroughPlan = async (request) => {
    const profile = await api.rendererPluginProfile();
    const source = (profile.catalog as RuntimePluginCatalogItem[]).find(
      (plugin) => plugin.id === request.pluginId,
    );
    if (!source) {
      throw new Error(`source plugin ${request.pluginId} was not found`);
    }
    const target = request.target ?? (
      source.processes.includes("main")
        ? "main-provider"
        : source.processes.includes("server")
          ? "server"
          : "renderer-provider"
    );
    const plan = await api.planPlugin({
      intent: "replace",
      plugin: {
        id: request.replacementId,
        name: request.name ?? `${source.name} (Custom)`,
        description: `E2E whole-folder replacement of ${source.name}.`,
        category: source.category,
      },
      sourcePluginId: request.pluginId,
      target,
      contributions: [],
      reveal: "none",
    });
    const draft = await api.copyAndReplacePlugin(plan.planId);
    if (draft.status !== "draft") return draft;
    return api.applyPlugin(draft.pluginId);
  };
}

function publishHostControl(): void {
  for (const listener of hostControlListeners) listener();
}

function publish(profile: ActiveRendererProfile | null): void {
  current = profile;
  for (const listener of listeners) listener();
}

async function activateFreshRendererProfile(
  data: RendererBootstrapData,
): Promise<ActiveRendererProfile> {
  try {
    activeData = data;
    const activatedProfile = await activateRendererProfile({
      data,
      transport: electronCapabilityTransport,
      hostControl,
    });
    const enrichedData = {
      ...data,
      catalog: overlayRuntimeCatalog(
        data.catalog as RuntimePluginCatalogItem[],
        activatedProfile.runtime,
        "renderer",
      ),
    };
    activeData = enrichedData;
    const profile: ActiveRendererProfile = {
      ...activatedProfile,
      catalog: enrichedData.catalog,
    };
    publishHostControl();
    publish(profile);
    const installImpactListener = bridge().onRendererPluginImpactRequested;
    if (!removeImpactListener && installImpactListener) {
      removeImpactListener = installImpactListener((pluginId) => {
        if (!current) throw new Error("renderer plugin runtime is not active");
        return current.runtime.previewPluginRemoval(pluginId);
      });
    }
    return profile;
  } catch (error) {
    active = null;
    activeData = null;
    publishHostControl();
    publish(null);
    throw error;
  }
}

function installReplacementListener(): void {
  removeReplacementListener ??= bridge().onRendererPluginProfileChanged(
    async (
      change: RendererProfileChange,
    ): Promise<RendererProfileChangeResult> => {
      try {
        if (change.phase === "quiesce") {
          // A selected renderer that failed during its first activation has no
          // live resources to quiesce. Still acknowledge the transaction so
          // main can atomically move to the protected recovery profile.
          if (current) {
            await quiesceRendererPlugins(
              change.profile,
              change.changedPluginIds,
              change.changedServiceNames,
            );
          }
        } else if (current) {
          await replaceRendererPlugins(
            change.profile,
            true,
            change.changedServiceNames,
          );
        } else {
          active = activateFreshRendererProfile(change.profile);
          await active;
        }
        return {
          ok: true,
          generation: activeData?.generation ?? change.profile.generation,
        };
      } catch (error) {
        return {
          ok: false,
          generation: activeData?.generation ?? change.profile.generation,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}

async function importRendererModule(
  descriptor: RendererPluginModuleDescriptor,
): Promise<PluginModule> {
  const imported = (await import(/* @vite-ignore */ descriptor.url)) as {
    default?: PluginModule;
  };
  if (!imported.default || typeof imported.default.activate !== "function") {
    throw new Error(
      `renderer plugin "${descriptor.pluginId}" does not export activate()`,
    );
  }
  return imported.default;
}

/** The profile that actually owns the currently-rendered application. */
export function currentRendererProfile(): ActiveRendererProfile | null {
  return current;
}

/** Observe renderer-profile replacement without copying runtime state into UI stores. */
export function subscribeRendererProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Boot exactly the renderer plugins selected by the main-process profile. */
export function bootRendererPlugins(): Promise<ActiveRendererProfile> {
  installE2EAuthoringSeam();
  // Install the transaction listener before activating the selected renderer.
  // If that activation fails, main can still cold-activate safe recovery in
  // this same window instead of leaving an unresponsive blank document.
  installReplacementListener();
  active ??= (async () => {
    const data = await bridge().rendererPluginProfile();
    return activateFreshRendererProfile(data);
  })();
  return active;
}

/** Stop the executable dependency-closed renderer slice before main tears down
 * destructive providers. Candidate modules are intentionally not activated
 * until Electron installs the candidate main router. */
export async function quiesceRendererPlugins(
  candidateData: RendererBootstrapData,
  externallyChangedPluginIds: readonly string[],
  externallyChangedServiceNames: readonly string[] = [],
): Promise<ActiveRendererProfile> {
  const previous = await active;
  const previousData = activeData;
  if (!previous || !previousData) {
    throw new Error("renderer plugin runtime is not active");
  }
  const candidateTree = deserializeRendererTree(candidateData);
  const changedServices = new Set(externallyChangedServiceNames);
  const activeModules = previous.runtime.activeModules();
  const processBridgeProviderIds = previous.runtime
    .serviceProviders()
    .filter(
      (provider) =>
        changedServices.has(provider.name) &&
        activeModules
          .get(provider.providerId)
          ?.inject?.includes(processTransportService) === true,
    )
    .map((provider) => provider.providerId);
  const changed = new Set([
    ...changedPluginIds(previous.tree, candidateTree),
    ...externallyChangedPluginIds,
    ...processBridgeProviderIds,
  ]);
  const affected = previous.runtime.dependencyClosedPluginIds(changed);
  const rendererIds = new Set(
    previous.processTree.plugins.map((plugin) => plugin.id),
  );
  const quiesced = new Set(
    [...affected].filter((pluginId) => rendererIds.has(pluginId)),
  );
  if (quiesced.size === 0) return previous;
  const candidatePluginIds = new Set(
    candidateData.plugins.map((plugin) => plugin.id),
  );
  const providerWasRemoved = externallyChangedPluginIds.some(
    (pluginId) => !candidatePluginIds.has(pluginId),
  );
  const allowPendingPluginIds = new Set(
    providerWasRemoved
      ? [...quiesced].filter((pluginId) => candidatePluginIds.has(pluginId))
      : [],
  );
  const hostWillUnmount = [...quiesced].some(
    (pluginId) =>
      activeModules.get(pluginId)?.replacementPolicy ===
      "unmount-before-dispose",
  );
  const data: RendererBootstrapData = {
    ...previousData,
    plugins: previousData.plugins.filter((plugin) => !quiesced.has(plugin.id)),
    activationOrder: previousData.activationOrder.filter(
      (pluginId) => !quiesced.has(pluginId),
    ),
    modules: previousData.modules.filter(
      (module) => !quiesced.has(module.pluginId),
    ),
  };
  // Keep the last settled root mounted while an unrelated dependency slice is
  // transaction-private. A presentation host can explicitly request a
  // synchronous unmount before its lifecycle-owned resources are disposed.
  if (hostWillUnmount) publish(null);
  try {
    const profile = await replaceRendererPlugins(data, false);
    quiescedTransaction = {
      profileId: candidateData.profileId,
      allowPendingPluginIds,
    };
    return profile;
  } catch (error) {
    const restored = await active;
    if (hostWillUnmount) publish(restored);
    throw error;
  }
}

/** Replace only the dependency-closed renderer slice whose implementation or
 * provider bindings changed. Unrelated providers keep their exact instances
 * and live resources; candidate failure rolls the affected slice back. */
export async function replaceRendererPlugins(
  data: RendererBootstrapData,
  publishCandidate = true,
  externallyChangedServiceNames: readonly string[] = [],
): Promise<ActiveRendererProfile> {
  const previousPromise = active;
  const previousData = activeData;
  const previous = await previousPromise;
  if (!previous || !previousData) {
    throw new Error("renderer plugin runtime is not active");
  }
  const tree = deserializeRendererTree(data);
  const processTree = projectPluginTree(tree, "renderer");
  const candidateRuntime = new CapabilityRuntime(processTree);
  const descriptors = new Map(
    data.modules.map((descriptor) => [descriptor.pluginId, descriptor]),
  );
  // A two-phase replacement may activate a graph identical to the quiesced
  // intermediate graph. In that no-op case the controller never calls
  // prepareCandidateRuntime, so retain the current disposer instead of
  // replacing it with a no-op and leaking the kernel transport factory.
  let candidateRemoveProcessServices = previous.removeProcessServices;
  let restoredRemoveProcessServices = previous.removeProcessServices;
  let restoredGeneration = previousData.generation;
  const previousWasPublished = current === previous;
  const changedServices = new Set(externallyChangedServiceNames);
  const externallyChangedBridgePluginIds = previous.runtime
    .serviceProviders()
    .filter(
      (provider) =>
        changedServices.has(provider.name) &&
        previous.runtime
          .activeModules()
          .get(provider.providerId)
          ?.inject?.includes(processTransportService) === true,
    )
    .map((provider) => provider.providerId);
  const allowPendingPluginIds =
    publishCandidate && quiescedTransaction?.profileId === data.profileId
      ? quiescedTransaction.allowPendingPluginIds
      : undefined;
  let settled!: ActiveRendererProfile;
  let replacementError: unknown;
  try {
    await previous.controller.replace(
      processTree,
      async (pluginId) => {
        const descriptor = descriptors.get(pluginId);
        if (!descriptor) {
          throw new Error(
            `renderer module descriptor for "${pluginId}" is missing`,
          );
        }
        const module = await importRendererModule(descriptor);
        return module;
      },
      () => true,
      {
        candidateRuntime,
        externallyChangedPluginIds: new Set([
          ...changedPluginIds(previous.tree, tree),
          ...externallyChangedBridgePluginIds,
        ]),
        allowPendingPluginIds,
        prepareCandidateRuntime(runtime) {
          previous.removeProcessServices();
          candidateRemoveProcessServices = installProcessServices(
            runtime,
            electronCapabilityTransport,
            hostControl,
            data.generation,
          );
        },
        prepareRollbackRuntime(runtime) {
          candidateRemoveProcessServices();
          // A rollback after candidate activation has already crossed into the
          // candidate transport epoch. Previous code reactivated here must bind
          // that issued generation; G0 is already quiesced for affected calls.
          restoredGeneration = data.generation;
          restoredRemoveProcessServices = installProcessServices(
            runtime,
            electronCapabilityTransport,
            hostControl,
            restoredGeneration,
          );
        },
      },
    );
    const enrichedData = {
      ...data,
      catalog: overlayRuntimeCatalog(
        data.catalog as RuntimePluginCatalogItem[],
        previous.controller.runtime,
        "renderer",
      ),
    };
    settled = {
      tree,
      processTree,
      runtime: previous.controller.runtime,
      controller: previous.controller,
      catalog: enrichedData.catalog,
      removeProcessServices: candidateRemoveProcessServices,
      async dispose() {
        await previous.controller.runtime.disposeAll();
        candidateRemoveProcessServices();
      },
    };
    activeData = enrichedData;
    active = Promise.resolve(settled);
  } catch (candidateError) {
    // LiveGraphController has already reactivated the previous affected slice.
    settled = {
      ...previous,
      runtime: previous.controller.runtime,
      removeProcessServices: restoredRemoveProcessServices,
    };
    activeData = { ...previousData, generation: restoredGeneration };
    active = Promise.resolve(settled);
    replacementError = candidateError;
  }

  // Observer publication is deliberately outside the controller transaction.
  // A render-listener failure must not be mistaken for plugin activation
  // failure and fed back through the controller rollback path.
  publishHostControl();
  if (replacementError === undefined) {
    if (publishCandidate) {
      quiescedTransaction = null;
      publish(settled);
    }
    return settled;
  }
  if (publishCandidate) quiescedTransaction = null;
  if (previousWasPublished) publish(settled);
  throw new Error(
    `renderer replacement failed; previous renderer was restored: ${replacementError instanceof Error ? replacementError.message : String(replacementError)}`,
  );
}

export async function disposeRendererPlugins(): Promise<void> {
  const currentPromise = active;
  active = null;
  activeData = null;
  quiescedTransaction = null;
  publishHostControl();
  removeReplacementListener?.();
  removeReplacementListener = null;
  removeImpactListener?.();
  removeImpactListener = null;
  publish(null);
  await (await currentPromise)?.dispose();
}

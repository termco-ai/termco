import type { ResolvedPluginTree } from "./contracts";
import { processServiceProxyMarker } from "./remoteCapabilities";

export type Dispose = () => void | Promise<void>;

/** Product-neutral identity for the process-local Kernel event primitive. */
export const kernelEventsService = "kernel.events" as const;

export type KernelEventListener = (payload: unknown) => void;
export type KernelAnyEventListener = (event: string, payload: unknown) => void;

/** Process-local events are a kernel primitive, so ordinary plugins never
 * become dependent on a removable event-bus provider. A bridge may redirect
 * outbound events and deliver remote events without duplicating them locally. */
export interface KernelEventsCapability {
  emit(event: string, payload: unknown): void;
  subscribe(event: string, listener: KernelEventListener): Dispose;
  subscribeAll(listener: KernelAnyEventListener): Dispose;
  listenerCount(event: string): number;
  connectOutbound(
    dispatch: (event: string, payload: unknown) => void,
  ): Dispose;
  deliver(event: string, payload: unknown): void;
}

export function createKernelEvents(): KernelEventsCapability {
  const listeners = new Map<string, Set<KernelEventListener>>();
  const allListeners = new Set<KernelAnyEventListener>();
  let outbound: ((event: string, payload: unknown) => void) | undefined;
  const deliver = (event: string, payload: unknown) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
    for (const listener of [...allListeners]) listener(event, payload);
  };
  return {
    emit(event, payload) {
      if (outbound) outbound(event, payload);
      else deliver(event, payload);
    },
    deliver,
    subscribe(event, listener) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        eventListeners.delete(listener);
        if (eventListeners.size === 0) listeners.delete(event);
      };
    },
    subscribeAll(listener) {
      allListeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        allListeners.delete(listener);
      };
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
    connectOutbound(dispatch) {
      if (outbound) throw new Error("kernel event bridge is already connected");
      outbound = dispatch;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (outbound === dispatch) outbound = undefined;
      };
    },
  };
}

export interface CapabilityEntry<T = unknown> {
  key: string;
  pluginId: string;
  value: T;
}

/** Stable identity for one lifecycle-owned contribution in one executable
 * plugin generation. Registries must retain this identity with the value. */
export interface ContributionOwner {
  pluginId: string;
  generation: string;
  key: string;
}

export interface ContributionRecord<T> extends ContributionOwner {
  value: T;
}

export interface OptionalCapability<T> {
  current(): T | undefined;
  subscribe(listener: () => void): Dispose;
}

/** Stable object identity for consumers that can operate against a defined
 * fallback while an optional provider leaves or returns. Standard `subscribe`
 * snapshots are rebound automatically across provider generations. */
export function createLiveOptionalFacade<T extends object>(
  capability: OptionalCapability<T>,
  fallback: T,
): { value: T; dispose: Dispose } {
  const listeners = new Set<(...args: unknown[]) => void>();
  let disposeProvider: Dispose | undefined;
  let fallbackSnapshot: unknown;
  let hasFallbackSnapshot = false;
  const publish = (...args: unknown[]) => {
    hasFallbackSnapshot = false;
    fallbackSnapshot = undefined;
    for (const listener of [...listeners]) listener(...args);
  };
  const bindProvider = () => {
    void disposeProvider?.();
    disposeProvider = undefined;
    const current = capability.current() as
      | (T & { subscribe?: (listener: (...args: unknown[]) => void) => Dispose })
      | undefined;
    const isGenericProcessProxy =
      current !== undefined &&
      Reflect.get(current, processServiceProxyMarker) === true;
    if (!isGenericProcessProxy && typeof current?.subscribe === "function") {
      disposeProvider = current.subscribe(publish);
    }
    publish();
  };
  const disposeObservation = capability.subscribe(bindProvider);
  bindProvider();
  const value = new Proxy({} as T, {
    get(_target, property) {
      if (property === "subscribe") {
        return (listener: (...args: unknown[]) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        };
      }
      const current = capability.current();
      const target = current ?? fallback;
      const member = Reflect.get(target, property, target) as unknown;
      if (
        current === undefined &&
        property === "snapshot" &&
        typeof member === "function"
      ) {
        return (...args: unknown[]) => {
          if (args.length > 0) return Reflect.apply(member, target, args);
          if (!hasFallbackSnapshot) {
            fallbackSnapshot = Reflect.apply(member, target, args);
            hasFallbackSnapshot = true;
          }
          return fallbackSnapshot;
        };
      }
      return typeof member === "function"
        ? (...args: unknown[]) => Reflect.apply(member, target, args)
        : member;
    },
  });
  return {
    value,
    dispose: async () => {
      await disposeProvider?.();
      await disposeObservation();
      listeners.clear();
    },
  };
}

export type FeatureUiPolicy =
  | "remove"
  | "retain-disabled"
  | "fallback"
  | "structured-unavailable";

export interface PluginFeatureDescriptor {
  id: string;
  label: string;
  requires: readonly string[];
  uiPolicy: FeatureUiPolicy;
}

export interface PluginActivationContext {
  readonly pluginId: string;
  /** Source integrity for the currently executing plugin generation. */
  readonly generation: string;
  get<T>(capability: string): T;
  observe<T>(capability: string): OptionalCapability<T>;
  feature(
    descriptor: PluginFeatureDescriptor,
    activate: (
      scope: PluginActivationContext,
    ) => void | Dispose | Promise<void | Dispose>,
  ): Dispose;
  entries<T>(capability: string): ReadonlyArray<CapabilityEntry<T>>;
  provide<T>(capability: string, value: T, key?: string): Dispose;
  effect(install: () => Dispose | Promise<Dispose>): Promise<Dispose>;
}

export interface PluginModule {
  /** Services that must be available before this plugin Fiber can activate. */
  readonly inject?: readonly string[];
  /** Services observed when present but whose absence must not block activation. */
  readonly optionalInject?: readonly string[];
  /** Generic host policy for providers whose mounted presentation must leave
   * before their lifecycle-owned resources are disposed. */
  readonly replacementPolicy?: "unmount-before-dispose";
  activate(
    context: PluginActivationContext,
  ): void | Dispose | Promise<void | Dispose>;
  /** Exact live resources that disposal will destroy during replacement. */
  replacementImpact?(): LiveResourceImpact[] | Promise<LiveResourceImpact[]>;
}

export interface LiveResourceImpact {
  capability: string;
  resourceLabel: string;
  resources: Array<{ id: string; label: string }>;
}

export type RuntimePluginState =
  | "inactive"
  | "pending"
  | "activating"
  | "active"
  | "unloading"
  | "failed";

interface ActiveScope {
  state: RuntimePluginState;
  effects: Dispose[];
  missingServices?: string[];
  error?: unknown;
}

export type RuntimeFeatureState = Exclude<RuntimePluginState, "inactive">;

interface FeatureScope {
  pluginId: string;
  descriptor: PluginFeatureDescriptor;
  activate: (
    scope: PluginActivationContext,
  ) => void | Dispose | Promise<void | Dispose>;
  parent?: FeatureScope;
  state: RuntimeFeatureState;
  effects: Dispose[];
  missingServices: string[];
  error?: unknown;
}

export interface RuntimeFeatureInspection {
  pluginId: string;
  featureId: string;
  label: string;
  state: RuntimeFeatureState;
  requires: string[];
  missingServices: string[];
  uiPolicy: FeatureUiPolicy;
  error?: unknown;
}

export interface PluginRemovalImpact {
  blockedPlugins: Array<{
    pluginId: string;
    missingServices: string[];
    via: string[];
  }>;
  unavailableFeatures: Array<{
    pluginId: string;
    featureId: string;
    label: string;
    uiPolicy: FeatureUiPolicy;
    missingServices: string[];
  }>;
  degradedPlugins: Array<{
    pluginId: string;
    optionalServices: string[];
  }>;
  destructiveResources: LiveResourceImpact[];
}

export interface RuntimeFiberInspection {
  pluginId: string;
  state: RuntimePluginState;
  missingServices?: string[];
  error?: unknown;
}

export interface RuntimeSettlementDiagnostic {
  pluginId: string;
  state: Extract<RuntimePluginState, "pending" | "failed">;
  missingServices?: string[];
  error?: unknown;
}

/** A live service exported from one runtime root. Values never cross the
 * process boundary; only this generic routing identity is serialized. */
export interface RuntimeServiceProvider {
  name: string;
  providerId: string;
}

export interface PluginLifecycleDiagnostics {
  pluginId: string;
  activationAttempts: number;
  successfulActivations: number;
  failedActivations: number;
  deactivations: number;
  registrations: number;
  disposals: number;
  activeEffects: number;
  cleanupFailures: number;
}

interface ProvidedValue {
  pluginId: string;
  key?: string;
  value: unknown;
  ownerScope?: ActiveScope | FeatureScope;
}

const EXTERNAL_FACTORY = Symbol("termco.external-capability-factory");
const RESERVED_SERVICE_NAMES = new Set([
  "kernel.context",
  "kernel.registry",
  "kernel.effects",
  "kernel.process-transport",
  kernelEventsService,
]);
interface ExternalCapabilityFactory {
  [EXTERNAL_FACTORY]: true;
  forConsumer(pluginId: string): unknown;
}

function isExternalFactory(value: unknown): value is ExternalCapabilityFactory {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Partial<ExternalCapabilityFactory>)[EXTERNAL_FACTORY] === true,
  );
}

/**
 * Open service Context/Fiber runtime. The tree supplies stable row/package
 * identity and deterministic inspection order; service names and dependency
 * edges come exclusively from executable plugin modules and live provisions.
 */
export class CapabilityRuntime {
  readonly #pluginsById;
  readonly #scopes = new Map<string, ActiveScope>();
  #values = new Map<string, ProvidedValue[]>();
  readonly #modules = new Map<string, PluginModule>();
  readonly #lifecycle = new Map<string, PluginLifecycleDiagnostics>();
  readonly #features = new Map<string, FeatureScope>();
  #optionalListeners = new Map<string, Set<() => void>>();
  #changedOptionalServices = new Set<string>();
  #kernelEvents = createKernelEvents();

  constructor(readonly tree: ResolvedPluginTree) {
    this.#pluginsById = new Map(
      tree.plugins.map((plugin) => [plugin.id, plugin]),
    );
  }

  inspect(): RuntimeFiberInspection[] {
    return this.tree.activationOrder.map((pluginId) => {
      const scope = this.#scopes.get(pluginId);
      return {
        pluginId,
        state: scope?.state ?? "inactive",
        ...(scope?.missingServices !== undefined
          ? { missingServices: [...scope.missingServices] }
          : {}),
        ...(scope?.error !== undefined ? { error: scope.error } : {}),
      };
    });
  }

  inspectFeatures(): RuntimeFeatureInspection[] {
    return [...this.#features.values()].map((scope) => ({
      pluginId: scope.pluginId,
      featureId: scope.descriptor.id,
      label: scope.descriptor.label,
      state: scope.state,
      requires: [...scope.descriptor.requires],
      missingServices: [...scope.missingServices],
      uiPolicy: scope.descriptor.uiPolicy,
      ...(scope.error !== undefined ? { error: scope.error } : {}),
    }));
  }

  /**
   * Direct lifecycle evidence for one plugin generation. Counts describe
   * resources registered through the public activation scope, including
   * provisions and the cleanup returned by activate().
   */
  lifecycleDiagnostics(pluginId: string): PluginLifecycleDiagnostics {
    const diagnostics = this.#lifecycle.get(pluginId);
    return diagnostics
      ? { ...diagnostics }
      : {
          pluginId,
          activationAttempts: 0,
          successfulActivations: 0,
          failedActivations: 0,
          deactivations: 0,
          registrations: 0,
          disposals: 0,
          activeEffects: 0,
          cleanupFailures: 0,
        };
  }

  settlementDiagnostics(): RuntimeSettlementDiagnostic[] {
    return this.tree.activationOrder.flatMap((pluginId) => {
      const scope = this.#scopes.get(pluginId);
      if (scope?.state !== "pending" && scope?.state !== "failed") return [];
      return [
        {
          pluginId,
          state: scope.state,
          ...(scope.missingServices !== undefined
            ? { missingServices: [...scope.missingServices] }
            : {}),
          ...(scope.error !== undefined ? { error: scope.error } : {}),
        },
      ];
    });
  }

  assertSettled(
    options: { allowPendingPluginIds?: ReadonlySet<string> } = {},
  ): void {
    const allowedPending = options.allowPendingPluginIds ?? new Set<string>();
    const inactivePluginIds = this.tree.activationOrder.filter((pluginId) => {
      const state = this.#scopes.get(pluginId)?.state;
      return state === undefined || state === "inactive";
    });
    const unsettled = this.settlementDiagnostics().filter(
      (fiber) =>
        fiber.state === "failed" || !allowedPending.has(fiber.pluginId),
    );
    const failedFeatures = this.inspectFeatures().filter(
      (feature) => feature.state === "failed",
    );
    if (
      inactivePluginIds.length === 0 &&
      unsettled.length === 0 &&
      failedFeatures.length === 0
    ) return;
    const details = unsettled.map((fiber) => {
      if (fiber.state === "pending") {
        return `plugin "${fiber.pluginId}" is pending; missing services: ${(fiber.missingServices ?? []).join(", ") || "unknown"}`;
      }
      const detail =
        fiber.error instanceof Error
          ? fiber.error.message
          : String(fiber.error);
      return `plugin "${fiber.pluginId}" failed: ${detail}`;
    });
    details.unshift(
      ...inactivePluginIds.map(
        (pluginId) => `plugin "${pluginId}" was not activated`,
      ),
    );
    details.push(
      ...failedFeatures.map((feature) => {
        const detail =
          feature.error instanceof Error
            ? feature.error.message
            : String(feature.error);
        return `plugin "${feature.pluginId}" feature "${feature.featureId}" failed: ${detail}`;
      }),
    );
    throw new Error(`runtime did not settle:\n${details.join("\n")}`);
  }

  async activate(pluginId: string, module: PluginModule): Promise<void> {
    if (!this.#pluginsById.has(pluginId)) {
      throw new Error(`plugin "${pluginId}" is not in the resolved tree`);
    }
    const existing = this.#scopes.get(pluginId);
    if (existing && existing.state !== "inactive") {
      throw new Error(`plugin "${pluginId}" is already activated`);
    }
    const scope: ActiveScope = { state: "pending", effects: [] };
    this.#scopes.set(pluginId, scope);
    this.#modules.set(pluginId, module);
    await this.#activateFiberIfReady(pluginId);
    await this.#settleRuntime();
    this.#flushOptionalNotifications();
  }

  async activateGraph(
    load: (pluginId: string) => Promise<PluginModule>,
  ): Promise<void> {
    const pluginIds = new Set(this.tree.activationOrder);
    try {
      await this.activatePlugins(pluginIds, load);
      this.assertSettled();
    } catch (error) {
      try {
        await this.deactivatePlugins(pluginIds);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `plugin graph activation failed and rollback cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }
  }

  /** Activate only one dependency-closed subset of this graph. Used by live
   * replacement so unrelated provider instances and resources stay alive. */
  async activatePlugins(
    pluginIds: ReadonlySet<string>,
    load: (pluginId: string) => Promise<PluginModule>,
  ): Promise<void> {
    try {
      for (const pluginId of this.tree.activationOrder) {
        if (!pluginIds.has(pluginId)) continue;
        await this.activate(pluginId, await load(pluginId));
      }
    } catch (error) {
      try {
        await this.deactivatePlugins(pluginIds);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `plugin graph activation failed and rollback cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }
  }

  /** Deactivate a dependency-closed subset in reverse activation order. */
  async deactivatePlugins(pluginIds: ReadonlySet<string>): Promise<void> {
    const closed = this.dependencyClosedPluginIds(pluginIds);
    await this.#unloadInOrder(
      this.#dependencyUnloadOrder(closed),
      "plugin graph cleanup failed",
      () => false,
    );
    await this.#settleRuntime();
    this.#flushOptionalNotifications();
  }

  /** Every active Fiber whose injected service is owned by the supplied
   * plugins, repeated transitively. This is the live replacement boundary. */
  dependencyClosedPluginIds(pluginIds: ReadonlySet<string>): Set<string> {
    const affected = new Set(pluginIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [consumerId, module] of this.#modules) {
        if (affected.has(consumerId)) continue;
        if (this.#scopes.get(consumerId)?.state !== "active") continue;
        const dependsOnAffected = (module.inject ?? []).some((service) =>
          (this.#values.get(service) ?? []).some((entry) =>
            affected.has(entry.pluginId),
          ),
        );
        if (dependsOnAffected) {
          affected.add(consumerId);
          changed = true;
        }
      }
    }
    return affected;
  }

  /** Move still-active plugin instances into a successor runtime without
   * re-running activation or cleanup. Both generations intentionally retain
   * the same value-map identity: existing effect disposers close over that map
   * and must continue removing their values after ownership moves. */
  adoptActivePluginsFrom(
    source: CapabilityRuntime,
    pluginIds: ReadonlySet<string>,
  ): void {
    this.#adoptPluginsFrom(source, pluginIds, new Set(["active"]));
  }

  /** Transfer unchanged active or dependency-pending Fibers into a successor. */
  adoptRegisteredPluginsFrom(
    source: CapabilityRuntime,
    pluginIds: ReadonlySet<string>,
  ): void {
    this.#adoptPluginsFrom(source, pluginIds, new Set(["active", "pending"]));
  }

  #adoptPluginsFrom(
    source: CapabilityRuntime,
    pluginIds: ReadonlySet<string>,
    allowedStates: ReadonlySet<RuntimePluginState>,
  ): void {
    if (
      this.#scopes.size > 0 ||
      this.#modules.size > 0 ||
      this.#values.size > 0
    ) {
      throw new Error(
        "active plugin state can only be adopted into an empty runtime",
      );
    }
    this.#values = source.#values;
    this.#kernelEvents = source.#kernelEvents;
    this.#optionalListeners = source.#optionalListeners;
    this.#changedOptionalServices = source.#changedOptionalServices;
    for (const pluginId of pluginIds) {
      const scope = source.#scopes.get(pluginId);
      const module = source.#modules.get(pluginId);
      if (!scope || !allowedStates.has(scope.state) || !module) {
        throw new Error(
          `cannot adopt ${scope?.state ?? "inactive"} plugin "${pluginId}"`,
        );
      }
      this.#scopes.set(pluginId, scope);
      this.#modules.set(pluginId, module);
      const diagnostics = source.#lifecycle.get(pluginId);
      if (diagnostics) this.#lifecycle.set(pluginId, diagnostics);
      source.#scopes.delete(pluginId);
      source.#modules.delete(pluginId);
      source.#lifecycle.delete(pluginId);
    }
    for (const [key, feature] of source.#features) {
      if (!pluginIds.has(feature.pluginId)) continue;
      this.#features.set(key, feature);
      source.#features.delete(key);
    }
  }

  async deactivate(pluginId: string): Promise<void> {
    const scope = this.#scopes.get(pluginId);
    if (!scope || scope.state === "inactive") return;
    const target = new Set([pluginId]);
    const closed = this.dependencyClosedPluginIds(target);
    await this.#unloadInOrder(
      this.#dependencyUnloadOrder(closed),
      `plugin "${pluginId}" cleanup failed`,
      (candidateId) => candidateId !== pluginId,
    );
    await this.#settleRuntime();
    this.#flushOptionalNotifications();
  }

  async disposeAll(): Promise<void> {
    const all = new Set(this.#modules.keys());
    await this.#unloadInOrder(
      this.#dependencyUnloadOrder(all),
      "plugin graph cleanup failed",
      () => false,
    );
  }

  activeModules(): ReadonlyMap<string, PluginModule> {
    return new Map(
      [...this.#modules].filter(
        ([pluginId]) => this.#scopes.get(pluginId)?.state === "active",
      ),
    );
  }

  registeredModules(): ReadonlyMap<string, PluginModule> {
    return new Map(this.#modules);
  }

  activePluginIdsWithMissingOptionalServices(): Set<string> {
    return new Set(
      [...this.#modules]
        .filter(([pluginId, module]) => {
          if (this.#scopes.get(pluginId)?.state !== "active") return false;
          return (module.optionalInject ?? []).some(
            (service) => (this.#values.get(service)?.length ?? 0) === 0,
          );
        })
        .map(([pluginId]) => pluginId),
    );
  }

  serviceProviders(): RuntimeServiceProvider[] {
    return [...this.#values]
      .flatMap(([name, values]) =>
        values
          .filter((entry) => !isExternalFactory(entry.value))
          .map((entry) => ({ name, providerId: entry.pluginId })),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.providerId.localeCompare(right.providerId),
      );
  }

  async replacementImpact(pluginId: string): Promise<LiveResourceImpact[]> {
    return (await this.#modules.get(pluginId)?.replacementImpact?.()) ?? [];
  }

  /** Explain the observable consequences of removing one provider before a
   * profile transaction mutates either process graph. */
  async previewPluginRemoval(pluginId: string): Promise<PluginRemovalImpact> {
    const affected = this.dependencyClosedPluginIds(new Set([pluginId]));
    const removedServices = new Set(
      [...this.#values]
        .filter(([, values]) =>
          values.some((entry) => affected.has(entry.pluginId)),
        )
        .map(([service]) => service),
    );
    const blockedPlugins = [...affected]
      .filter((candidateId) => candidateId !== pluginId)
      .map((candidateId) => {
        const missingServices = (this.#modules.get(candidateId)?.inject ?? [])
          .filter((service) => removedServices.has(service));
        return {
          pluginId: candidateId,
          missingServices,
          via: [...missingServices],
        };
      });
    const unavailableFeatures = this.inspectFeatures()
      .filter((feature) => !affected.has(feature.pluginId))
      .map((feature) => ({
        ...feature,
        missingServices: feature.requires.filter((service) =>
          removedServices.has(service),
        ),
      }))
      .filter((feature) => feature.missingServices.length > 0)
      .map(({ pluginId: ownerId, featureId, label, uiPolicy, missingServices }) => ({
        pluginId: ownerId,
        featureId,
        label,
        uiPolicy,
        missingServices,
      }));
    const degradedPlugins = [...this.#modules]
      .filter(([candidateId]) => !affected.has(candidateId))
      .map(([candidateId, module]) => ({
        pluginId: candidateId,
        optionalServices: (module.optionalInject ?? []).filter((service) =>
          removedServices.has(service),
        ),
      }))
      .filter((candidate) => candidate.optionalServices.length > 0);
    const destructiveResources = (
      await Promise.all(
        [...affected].map((candidateId) =>
          this.replacementImpact(candidateId),
        ),
      )
    ).flat();
    return {
      blockedPlugins,
      unavailableFeatures,
      degradedPlugins,
      destructiveResources,
    };
  }

  /** Install a kernel-owned proxy for a provider living in another process. */
  installExternalCapability(
    capability: string,
    providerId: string,
    value: unknown,
  ): Dispose {
    const values = this.#values.get(capability) ?? [];
    this.#assertServiceCanBeProvided(
      capability,
      providerId,
      values,
      providerId === "kernel" && capability === "kernel.process-transport",
    );
    const entry: ProvidedValue = { pluginId: providerId, value };
    values.push(entry);
    this.#values.set(capability, values);
    this.#optionalServiceChanged(capability);
    this.#flushOptionalNotifications();
    return () => {
      const removeValue = () => {
        const next = (this.#values.get(capability) ?? []).filter(
          (candidate) => candidate !== entry,
        );
        if (next.length > 0) this.#values.set(capability, next);
        else this.#values.delete(capability);
        this.#optionalServiceChanged(capability);
      };
      const hasActiveFeature = [...this.#features.values()].some(
        (scope) =>
          scope.state === "active" &&
          scope.descriptor.requires.includes(capability),
      );
      if (!hasActiveFeature) {
        removeValue();
        this.#flushOptionalNotifications();
        return;
      }
      return (async () => {
        await this.#suspendFeaturesRequiringServices(new Set([capability]));
        removeValue();
        await this.#settleRuntime();
        this.#flushOptionalNotifications();
      })();
    };
  }

  installExternalCapabilityFactory(
    capability: string,
    providerId: string,
    forConsumer: (pluginId: string) => unknown,
  ): Dispose {
    return this.installExternalCapability(capability, providerId, {
      [EXTERNAL_FACTORY]: true,
      forConsumer,
    } satisfies ExternalCapabilityFactory);
  }

  /** Kernel IPC calls a method without exposing the provider object itself. */
  async callCapability(
    capability: string,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    if (capability === kernelEventsService) {
      const target = this.#kernelEvents as unknown as Record<string, unknown>;
      const callable = target[method];
      if (typeof callable !== "function" || method === "constructor") {
        throw new Error(`capability "${capability}" has no method "${method}"`);
      }
      return Reflect.apply(callable, target, args);
    }
    const values = this.#values.get(capability) ?? [];
    if (values.length !== 1)
      throw new Error(`capability "${capability}" is unavailable`);
    const target = values[0].value as Record<string, unknown>;
    const callable = target?.[method];
    if (typeof callable !== "function" || method === "constructor") {
      throw new Error(`capability "${capability}" has no method "${method}"`);
    }
    return Reflect.apply(callable, target, args);
  }

  /** Platform-process adapters may borrow the selected provider object. */
  platformCapability<T>(capability: string): T {
    const values = this.#values.get(capability) ?? [];
    if (values.length !== 1 || isExternalFactory(values[0].value)) {
      throw new Error(
        `capability "${capability}" is unavailable in this process`,
      );
    }
    return values[0].value as T;
  }

  #context(
    pluginId: string,
    scope: ActiveScope | FeatureScope,
  ): PluginActivationContext {
    const plugin = this.#pluginsById.get(pluginId);
    if (!plugin) {
      throw new Error(`unknown plugin "${pluginId}"`);
    }

    return {
      pluginId,
      generation:
        plugin.source.integrity ??
        `${plugin.manifest.id}@${plugin.manifest.version}:${plugin.source.location}`,
      get: <T>(capability: string): T => {
        this.#assertCapabilityReadAllowed(pluginId, scope, capability);
        if (capability === kernelEventsService) return this.#kernelEvents as T;
        const values = this.#values.get(capability) ?? [];
        if (values.length === 0) return undefined as T;
        if (values.length > 1)
          throw new Error(`service "${capability}" is ambiguous`);
        const value = values[0].value;
        return (
          isExternalFactory(value) ? value.forConsumer(pluginId) : value
        ) as T;
      },
      observe: <T>(capability: string): OptionalCapability<T> => {
        const module = this.#modules.get(pluginId);
        if (!(module?.optionalInject ?? []).includes(capability)) {
          throw new Error(
            `plugin "${pluginId}" must declare optionalInject for service "${capability}" before observing it`,
          );
        }
        return {
          current: () => this.#capabilityForConsumer<T>(capability, pluginId),
          subscribe: (listener) => {
            const listeners = this.#optionalListeners.get(capability) ?? new Set();
            listeners.add(listener);
            this.#optionalListeners.set(capability, listeners);
            return () => {
              listeners.delete(listener);
              if (listeners.size === 0) this.#optionalListeners.delete(capability);
            };
          },
        };
      },
      feature: (descriptor, activate) =>
        this.#registerFeature(pluginId, scope, descriptor, activate),
      entries: <T>(capability: string): ReadonlyArray<CapabilityEntry<T>> => {
        return (this.#values.get(capability) ?? []).map((value) => ({
          key: value.key as string,
          pluginId: value.pluginId,
          value: value.value as T,
        }));
      },
      provide: <T>(capability: string, value: T, key?: string): Dispose => {
        const values = this.#values.get(capability) ?? [];
        this.#assertServiceCanBeProvided(capability, pluginId, values);
        const entry: ProvidedValue = { pluginId, key, value, ownerScope: scope };
        values.push(entry);
        this.#values.set(capability, values);
        this.#optionalServiceChanged(capability);
        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          const current = this.#values.get(capability) ?? [];
          const next = current.filter((candidate) => candidate !== entry);
          if (next.length > 0) this.#values.set(capability, next);
          else this.#values.delete(capability);
          this.#optionalServiceChanged(capability);
        };
        return this.#registerEffect(pluginId, scope, dispose);
      },
      effect: async (install) => {
        const dispose = await install();
        return this.#registerEffect(pluginId, scope, dispose);
      },
    };
  }

  #assertCapabilityReadAllowed(
    pluginId: string,
    scope: ActiveScope | FeatureScope,
    capability: string,
  ): void {
    if (RESERVED_SERVICE_NAMES.has(capability)) return;
    const module = this.#modules.get(pluginId);
    if (
      this.#isFeatureScope(scope) &&
      scope.descriptor.requires.includes(capability)
    ) {
      return;
    }
    if ((module?.optionalInject ?? []).includes(capability)) {
      throw new Error(
        `plugin "${pluginId}" must use observe() for optional service "${capability}"`,
      );
    }
    if ((module?.inject ?? []).includes(capability)) return;
    if (
      (this.#values.get(capability) ?? []).some(
        (entry) => entry.pluginId === pluginId,
      )
    ) {
      return;
    }
    throw new Error(
      `plugin "${pluginId}" must declare inject for service "${capability}" before reading it`,
    );
  }

  #featureKey(pluginId: string, featureId: string): string {
    return `${pluginId}\0${featureId}`;
  }

  #registerFeature(
    pluginId: string,
    owner: ActiveScope | FeatureScope,
    descriptor: PluginFeatureDescriptor,
    activate: FeatureScope["activate"],
  ): Dispose {
    if (!descriptor.id.trim()) throw new Error("feature id must not be empty");
    if (!descriptor.label.trim()) throw new Error("feature label must not be empty");
    const key = this.#featureKey(pluginId, descriptor.id);
    if (this.#features.has(key)) {
      throw new Error(
        `plugin "${pluginId}" already registered feature "${descriptor.id}"`,
      );
    }
    const scope: FeatureScope = {
      pluginId,
      descriptor: {
        ...descriptor,
        requires: [...new Set(descriptor.requires)],
      },
      activate,
      ...(this.#isFeatureScope(owner) ? { parent: owner } : {}),
      state: "pending",
      effects: [],
      missingServices: [],
    };
    scope.missingServices = this.#missingFeatureServices(scope);
    this.#features.set(key, scope);
    let disposed = false;
    return async () => {
      if (disposed) return;
      disposed = true;
      await this.#unloadFeature(scope, false);
    };
  }

  #isFeatureScope(scope: ActiveScope | FeatureScope): scope is FeatureScope {
    return "descriptor" in scope;
  }

  #missingFeatureServices(scope: FeatureScope): string[] {
    return [...scope.descriptor.requires].filter(
      (service) =>
        service !== kernelEventsService &&
        (this.#values.get(service)?.length ?? 0) === 0,
    );
  }

  async #activateFeatureIfReady(scope: FeatureScope): Promise<boolean> {
    if (scope.state !== "pending") return false;
    if (this.#scopes.get(scope.pluginId)?.state !== "active") return false;
    if (scope.parent && scope.parent.state !== "active") return false;
    scope.missingServices = this.#missingFeatureServices(scope);
    if (scope.missingServices.length > 0) return false;
    scope.state = "activating";
    delete scope.error;
    try {
      const cleanup = await scope.activate(this.#context(scope.pluginId, scope));
      if (typeof cleanup === "function") {
        this.#registerEffect(scope.pluginId, scope, cleanup);
      }
      scope.state = "active";
    } catch (error) {
      scope.state = "failed";
      scope.error = error;
      try {
        await this.#disposeEffects(scope.pluginId, scope);
      } catch (cleanupError) {
        scope.error = new AggregateError(
          [error, cleanupError],
          `feature "${scope.descriptor.id}" activation and cleanup failed`,
        );
      }
    }
    return true;
  }

  async #settlePendingFeatures(): Promise<boolean> {
    let anyProgress = false;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const scope of this.#features.values()) {
        if (await this.#activateFeatureIfReady(scope)) {
          progressed = true;
          anyProgress = true;
        }
      }
    }
    return anyProgress;
  }

  async #settleRuntime(): Promise<void> {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const activeBefore = [...this.#scopes.values()].filter(
        (scope) => scope.state === "active",
      ).length;
      await this.#settlePendingFibers();
      const activeAfter = [...this.#scopes.values()].filter(
        (scope) => scope.state === "active",
      ).length;
      if (activeAfter > activeBefore) progressed = true;
      if (await this.#settlePendingFeatures()) progressed = true;
    }
  }

  async #unloadFeature(scope: FeatureScope, retainRegistration: boolean): Promise<void> {
    for (const child of [...this.#features.values()].reverse()) {
      if (child.parent === scope) await this.#unloadFeature(child, false);
    }
    if (scope.state === "active" || scope.state === "activating" || scope.state === "failed") {
      scope.state = "unloading";
      const providedServices = new Set(
        [...this.#values].flatMap(([service, values]) =>
          values.some((entry) => entry.ownerScope === scope) ? [service] : [],
        ),
      );
      await this.#suspendHardConsumersRequiringServices(providedServices);
      await this.#disposeEffects(scope.pluginId, scope);
    }
    if (retainRegistration) {
      scope.state = "pending";
      scope.missingServices = this.#missingFeatureServices(scope);
      delete scope.error;
    } else {
      this.#features.delete(this.#featureKey(scope.pluginId, scope.descriptor.id));
    }
  }

  async #suspendFeaturesDependingOnProvider(providerPluginId: string): Promise<void> {
    const providedServices = new Set(
      [...this.#values].flatMap(([service, values]) =>
        values.some((entry) => entry.pluginId === providerPluginId) ? [service] : [],
      ),
    );
    await this.#suspendFeaturesRequiringServices(
      providedServices,
      providerPluginId,
    );
  }

  async #suspendFeaturesRequiringServices(
    providedServices: ReadonlySet<string>,
    providerPluginId?: string,
  ): Promise<void> {
    if (providedServices.size === 0) return;
    for (const scope of [...this.#features.values()].reverse()) {
      if (scope.pluginId === providerPluginId || scope.state !== "active") continue;
      if (scope.descriptor.requires.some((service) => providedServices.has(service))) {
        await this.#unloadFeature(scope, true);
      }
    }
  }

  async #suspendHardConsumersRequiringServices(
    services: ReadonlySet<string>,
  ): Promise<void> {
    if (services.size === 0) return;
    const directConsumers = new Set(
      [...this.#modules].flatMap(([pluginId, module]) =>
        this.#scopes.get(pluginId)?.state === "active" &&
        (module.inject ?? []).some((service) => services.has(service))
          ? [pluginId]
          : [],
      ),
    );
    if (directConsumers.size === 0) return;
    const closed = this.dependencyClosedPluginIds(directConsumers);
    await this.#unloadInOrder(
      this.#dependencyUnloadOrder(closed),
      "child service dependent cleanup failed",
      () => true,
    );
  }

  #capabilityForConsumer<T>(capability: string, pluginId: string): T | undefined {
    const values = this.#values.get(capability) ?? [];
    if (values.length === 0) return undefined;
    if (values.length > 1) throw new Error(`service "${capability}" is ambiguous`);
    const value = values[0].value;
    return (isExternalFactory(value) ? value.forConsumer(pluginId) : value) as T;
  }

  #optionalServiceChanged(capability: string): void {
    if (this.#optionalListeners.has(capability)) {
      this.#changedOptionalServices.add(capability);
    }
  }

  #flushOptionalNotifications(): void {
    const changed = [...this.#changedOptionalServices];
    this.#changedOptionalServices.clear();
    for (const capability of changed) {
      for (const listener of [...(this.#optionalListeners.get(capability) ?? [])]) {
        listener();
      }
    }
  }

  async #activateFiberIfReady(pluginId: string): Promise<boolean> {
    const module = this.#modules.get(pluginId);
    const scope = this.#scopes.get(pluginId);
    if (!module || !scope || scope.state !== "pending") return false;
    const missingServices = this.#missingServices(module);
    if (missingServices.length > 0) {
      scope.missingServices = missingServices;
      return false;
    }

    scope.state = "activating";
    delete scope.missingServices;
    delete scope.error;
    const diagnostics = this.#diagnostics(pluginId);
    diagnostics.activationAttempts += 1;
    try {
      const cleanup = await module.activate(this.#context(pluginId, scope));
      if (typeof cleanup === "function") {
        this.#registerEffect(pluginId, scope, cleanup);
      }
      scope.state = "active";
      diagnostics.successfulActivations += 1;
      return true;
    } catch (error) {
      scope.state = "failed";
      scope.error = error;
      diagnostics.failedActivations += 1;
      try {
        for (const feature of [...this.#features.values()].reverse()) {
          if (feature.pluginId === pluginId && !feature.parent) {
            await this.#unloadFeature(feature, false);
          }
        }
        await this.#disposeEffects(pluginId, scope);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `plugin "${pluginId}" activation failed and cleanup failed`,
        );
      }
      throw error;
    }
  }

  async #settlePendingFibers(): Promise<void> {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const pluginId of this.tree.activationOrder) {
        if (await this.#activateFiberIfReady(pluginId)) progressed = true;
      }
    }
  }

  #missingServices(module: PluginModule): string[] {
    return [...new Set(module.inject ?? [])].filter(
      (service) =>
        service !== kernelEventsService &&
        (this.#values.get(service)?.length ?? 0) === 0,
    );
  }

  #assertServiceCanBeProvided(
    service: string,
    providerId: string,
    existing: readonly ProvidedValue[],
    allowReserved = false,
  ): void {
    if (!service.trim()) throw new Error("service name must not be empty");
    if (RESERVED_SERVICE_NAMES.has(service) && !allowReserved) {
      throw new Error(`service "${service}" is reserved by the kernel`);
    }
    const previous = existing[0];
    if (previous) {
      throw new Error(
        `service "${service}" is already provided by plugin "${previous.pluginId}"; plugin "${providerId}" cannot also provide it`,
      );
    }
  }

  #dependencyUnloadOrder(pluginIds: ReadonlySet<string>): string[] {
    const providersByService = new Map<string, Set<string>>();
    for (const [service, values] of this.#values) {
      providersByService.set(
        service,
        new Set(values.map((entry) => entry.pluginId)),
      );
    }
    const dependents = new Map<string, Set<string>>();
    for (const [consumerId, module] of this.#modules) {
      if (this.#scopes.get(consumerId)?.state !== "active") continue;
      for (const service of module.inject ?? []) {
        for (const providerId of providersByService.get(service) ?? []) {
          const entries = dependents.get(providerId) ?? new Set<string>();
          entries.add(consumerId);
          dependents.set(providerId, entries);
        }
      }
    }
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (pluginId: string) => {
      if (visited.has(pluginId) || visiting.has(pluginId)) return;
      visiting.add(pluginId);
      for (const dependent of dependents.get(pluginId) ?? []) {
        if (pluginIds.has(dependent)) visit(dependent);
      }
      visiting.delete(pluginId);
      visited.add(pluginId);
      if (this.#modules.has(pluginId)) ordered.push(pluginId);
    };
    for (const pluginId of this.tree.activationOrder) {
      if (pluginIds.has(pluginId)) visit(pluginId);
    }
    return ordered;
  }

  async #unloadFiber(
    pluginId: string,
    retainRegistration: boolean,
  ): Promise<void> {
    const scope = this.#scopes.get(pluginId);
    const module = this.#modules.get(pluginId);
    if (!scope || scope.state === "inactive") return;
    let cleanupError: unknown;
    scope.state = "unloading";
    try {
      await this.#suspendFeaturesDependingOnProvider(pluginId);
      for (const feature of [...this.#features.values()].reverse()) {
        if (feature.pluginId === pluginId && !feature.parent) {
          await this.#unloadFeature(feature, false);
        }
      }
      await this.#disposeEffects(pluginId, scope);
    } catch (error) {
      cleanupError = error;
    } finally {
      scope.state = retainRegistration ? "pending" : "inactive";
      delete scope.error;
      if (retainRegistration && module) {
        scope.missingServices = this.#missingServices(module);
      } else {
        delete scope.missingServices;
        this.#modules.delete(pluginId);
      }
      this.#diagnostics(pluginId).deactivations += 1;
    }
    if (cleanupError !== undefined) throw cleanupError;
  }

  #diagnostics(pluginId: string): PluginLifecycleDiagnostics {
    let diagnostics = this.#lifecycle.get(pluginId);
    if (!diagnostics) {
      diagnostics = this.lifecycleDiagnostics(pluginId);
      this.#lifecycle.set(pluginId, diagnostics);
    }
    return diagnostics;
  }

  #registerEffect(
    pluginId: string,
    scope: ActiveScope | FeatureScope,
    dispose: Dispose,
  ): Dispose {
    const diagnostics = this.#diagnostics(pluginId);
    diagnostics.registrations += 1;
    diagnostics.activeEffects += 1;
    let disposed = false;
    const trackedDispose = async () => {
      if (disposed) return;
      disposed = true;
      diagnostics.disposals += 1;
      diagnostics.activeEffects -= 1;
      try {
        await dispose();
      } catch (error) {
        diagnostics.cleanupFailures += 1;
        throw error;
      }
    };
    scope.effects.push(trackedDispose);
    return trackedDispose;
  }

  async #unloadInOrder(
    pluginIds: readonly string[],
    failureMessage: string,
    retainRegistration: (pluginId: string) => boolean,
  ): Promise<void> {
    const failures: unknown[] = [];
    for (const pluginId of pluginIds) {
      try {
        await this.#unloadFiber(pluginId, retainRegistration(pluginId));
      } catch (error) {
        failures.push(error);
      }
    }
    for (const [pendingId, pendingScope] of this.#scopes) {
      if (pendingScope.state !== "pending") continue;
      const module = this.#modules.get(pendingId);
      if (module) pendingScope.missingServices = this.#missingServices(module);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, failureMessage);
    }
  }

  async #disposeEffects(pluginId: string, scope: ActiveScope): Promise<void> {
    const effects = scope.effects.splice(0).reverse();
    const failures: unknown[] = [];
    for (const dispose of effects) {
      try {
        await dispose();
      } catch (error) {
        // Continue so one broken cleanup cannot prevent the remaining scopes
        // from being disposed, but never report the lifecycle as successful.
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `plugin "${pluginId}" cleanup failed (${failures.length} disposer${failures.length === 1 ? "" : "s"})`,
      );
    }
  }
}

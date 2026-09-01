import { BrowserWindow, ipcMain, webContents } from "electron";
import { randomUUID } from "node:crypto";
import type { CapabilityCall } from "../../../src/platform/remoteCapabilities";
import {
  CapabilityRpcRouter,
  processTransportService,
  type ProcessRemoteDispose,
} from "../../../src/platform/remoteCapabilities";
import { captureCapabilityResult } from "../../../src/platform/capabilityWire";
import type {
  RendererBootstrapData,
  RendererProfileChange,
} from "../../../src/platform/rendererBootstrap";
import type { PluginRemovalImpact } from "../../../src/platform/runtime";
import { labelForSender } from "../windows";

const CHANNEL = "termco:services:call";
const RENDERER_PROFILE_CHANNEL = "termco:plugins:renderer-profile";
const RENDERER_REPLACE_CHANNEL = "termco:plugins:renderer-profile-change";
const RENDERER_REPLACE_RESULT_CHANNEL =
  "termco:plugins:renderer-profile-change-result";
const RENDERER_IMPACT_CHANNEL = "termco:plugins:renderer-impact";
const RENDERER_IMPACT_RESULT_CHANNEL =
  "termco:plugins:renderer-impact-result";

const emptyRemovalImpact = (): PluginRemovalImpact => ({
  blockedPlugins: [],
  unavailableFeatures: [],
  degradedPlugins: [],
  destructiveResources: [],
});

export function mergePluginRemovalImpacts(
  impacts: readonly PluginRemovalImpact[],
): PluginRemovalImpact {
  const merged = emptyRemovalImpact();
  const blocked = new Map<string, PluginRemovalImpact["blockedPlugins"][number]>();
  const features = new Map<string, PluginRemovalImpact["unavailableFeatures"][number]>();
  const degraded = new Map<string, PluginRemovalImpact["degradedPlugins"][number]>();
  const resources = new Map<string, PluginRemovalImpact["destructiveResources"][number]>();
  for (const impact of impacts) {
    for (const item of impact.blockedPlugins) {
      const previous = blocked.get(item.pluginId);
      blocked.set(item.pluginId, {
        pluginId: item.pluginId,
        missingServices: [...new Set([...(previous?.missingServices ?? []), ...item.missingServices])],
        via: [...new Set([...(previous?.via ?? []), ...item.via])],
      });
    }
    for (const item of impact.unavailableFeatures) {
      const key = `${item.pluginId}\0${item.featureId}`;
      const previous = features.get(key);
      features.set(key, {
        ...item,
        missingServices: [...new Set([...(previous?.missingServices ?? []), ...item.missingServices])],
      });
    }
    for (const item of impact.degradedPlugins) {
      const previous = degraded.get(item.pluginId);
      degraded.set(item.pluginId, {
        pluginId: item.pluginId,
        optionalServices: [...new Set([...(previous?.optionalServices ?? []), ...item.optionalServices])],
      });
    }
    for (const item of impact.destructiveResources) {
      const key = `${item.capability}\0${item.resourceLabel}`;
      const previous = resources.get(key);
      const byId = new Map(
        [...(previous?.resources ?? []), ...item.resources].map((resource) => [resource.id, resource]),
      );
      resources.set(key, { ...item, resources: [...byId.values()] });
    }
  }
  merged.blockedPlugins = [...blocked.values()];
  merged.unavailableFeatures = [...features.values()];
  merged.degradedPlugins = [...degraded.values()];
  merged.destructiveResources = [...resources.values()];
  return merged;
}

function parseCall(input: unknown): CapabilityCall {
  if (!input || typeof input !== "object") throw new Error("invalid capability call");
  const call = input as Partial<CapabilityCall>;
  if (
    typeof call.consumerPluginId !== "string" ||
    (call.rendererGeneration !== undefined &&
      typeof call.rendererGeneration !== "string") ||
    typeof call.capability !== "string" ||
    typeof call.method !== "string" ||
    !Array.isArray(call.args) ||
    (call.caller !== undefined && typeof call.caller !== "boolean") ||
    (call.callerFields !== undefined &&
      (!call.callerFields ||
        typeof call.callerFields !== "object" ||
        Array.isArray(call.callerFields))) ||
    (call.callerFields !== undefined && call.caller !== true)
  ) {
    throw new Error("invalid capability call fields");
  }
  return call as CapabilityCall;
}

type ChannelMarker = { __termcoChannel: number };

function channelSender(
  sender: Electron.WebContents,
  marker: unknown,
): (...messages: unknown[]) => void {
  const id = (marker as Partial<ChannelMarker> | null)?.__termcoChannel;
  if (!Number.isInteger(id)) throw new Error("invalid capability stream channel");
  return (...messages) => {
    if (!sender.isDestroyed()) {
      sender.send("termco:channel", id, {
        __termcoChannelArgs: messages,
      });
    }
  };
}

function materializeRendererChannels(
  value: unknown,
  sender: Electron.WebContents,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (Array.isArray(value)) {
    const previous = seen.get(value);
    if (previous) return previous;
    const result: unknown[] = [];
    seen.set(value, result);
    for (const entry of value) {
      result.push(materializeRendererChannels(entry, sender, seen));
    }
    return result;
  }
  if (!value || typeof value !== "object") return value;
  const channelId = (value as Partial<ChannelMarker>).__termcoChannel;
  if (Number.isInteger(channelId)) return channelSender(sender, value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const previous = seen.get(value);
  if (previous) return previous;
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const [key, entry] of Object.entries(value)) {
    result[key] = materializeRendererChannels(entry, sender, seen);
  }
  return result;
}

/** Materialize family-selected callback markers recursively. The generic host
 * knows channel envelopes, never product service or method names. */
export function attachRendererChannels(
  call: CapabilityCall,
  sender: Electron.WebContents,
): CapabilityCall {
  return {
    ...call,
    args: call.args.map((entry) => materializeRendererChannels(entry, sender)),
  };
}

/** Renderer identity is transport state, never a plugin-supplied argument. */
export function attachAuthenticatedCaller(
  call: CapabilityCall,
  senderWebContentsId: number,
  windowId?: number,
  windowLabel?: string,
): CapabilityCall {
  if (!call.caller) return call;
  return {
    ...call,
    args: [
      ...call.args,
      {
        ...call.callerFields,
        senderWebContentsId,
        windowId,
        windowLabel,
      },
    ],
  };
}

interface RendererReplacementResult {
  requestId: string;
  ok: boolean;
  generation?: string;
  error?: string;
}

interface PendingReplacement {
  remaining: Set<number>;
  errors: string[];
  expectedGenerations: Map<number, string>;
  acknowledgedGenerations: Map<number, string>;
  resolve: (generations: Map<number, string>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingImpactInspection {
  remaining: Set<number>;
  impacts: PluginRemovalImpact[];
  errors: string[];
  resolve: (impact: PluginRemovalImpact) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface RemoteDisposer {
  senderId: number;
  consumerPluginId: string;
  dispose: () => void | Promise<void>;
}

/** Opaque, sender-scoped ownership for provider-returned cleanup functions. */
export class RemoteDisposerRegistry {
  readonly #entries = new Map<string, RemoteDisposer>();
  #sequence = 0;

  register(
    senderId: number,
    consumerPluginId: string,
    dispose: RemoteDisposer["dispose"],
  ): ProcessRemoteDispose {
    const id = `${senderId}:${++this.#sequence}`;
    this.#entries.set(id, { senderId, consumerPluginId, dispose });
    return { __termcoDispose: id };
  }

  async release(
    senderId: number,
    consumerPluginId: string,
    marker: unknown,
  ): Promise<void> {
    const id = (marker as Partial<ProcessRemoteDispose> | null)
      ?.__termcoDispose;
    if (typeof id !== "string") throw new Error("invalid remote disposer handle");
    const entry = this.#entries.get(id);
    if (!entry) return;
    if (
      entry.senderId !== senderId ||
      entry.consumerPluginId !== consumerPluginId
    ) {
      throw new Error("remote disposer handle does not belong to this caller");
    }
    this.#entries.delete(id);
    await entry.dispose();
  }

  async releaseSender(senderId: number): Promise<void> {
    const owned = [...this.#entries.entries()].filter(
      ([, entry]) => entry.senderId === senderId,
    );
    for (const [id] of owned) this.#entries.delete(id);
    await Promise.all(owned.map(([, entry]) => entry.dispose()));
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.all(entries.map((entry) => entry.dispose()));
  }
}

/** Long-lived Electron transport whose runtime tree can change atomically without
 * unregistering IPC while renderer consumers are still in flight. */
export class CapabilityIpcHost {
  #router: CapabilityRpcRouter;
  #rendererProfile: RendererBootstrapData;
  readonly #rendererConsumers = new Set<number>();
  readonly #trackedSenders = new Set<number>();
  readonly #remoteDisposers = new RemoteDisposerRegistry();
  readonly #pending = new Map<string, PendingReplacement>();
  readonly #pendingImpactInspections = new Map<string, PendingImpactInspection>();
  readonly #inFlightCalls = new Map<
    Promise<unknown>,
    { providerId?: string; generation: string; senderId: number }
  >();
  readonly #issuedRendererGenerations = new Map<number, Set<string>>();
  readonly #activeRendererGenerations = new Map<number, string>();
  readonly #blockedProviderPluginIds = new Map<
    number,
    Map<string, Set<string>>
  >();
  #sequence = 0;

  constructor(router: CapabilityRpcRouter, rendererProfile: RendererBootstrapData) {
    this.#router = router;
    this.#rendererProfile = this.#withFreshGeneration(rendererProfile);
    ipcMain.handle(CHANNEL, (event, input: unknown) =>
      captureCapabilityResult(async () => {
        this.#trackSender(event.sender);
        const win = BrowserWindow.fromWebContents(event.sender);
        const call = attachAuthenticatedCaller(
          parseCall(input),
          event.sender.id,
          win?.id,
          labelForSender(event.sender),
        );
        const generation = call.rendererGeneration;
        if (
          typeof generation !== "string" ||
          !this.#issuedRendererGenerations
            .get(event.sender.id)
            ?.has(generation)
        ) {
          throw new Error("renderer capability generation is missing or unknown");
        }
        if (
          call.capability === processTransportService &&
          call.method === "release"
        ) {
          await this.#remoteDisposers.release(
            event.sender.id,
            call.consumerPluginId,
            call.args[0],
          );
          return undefined;
        }
        const providerId = this.#router.providerRuntime
          .serviceProviders()
          .find((provider) => provider.name === call.capability)?.providerId;
        if (
          providerId &&
          this.#blockedProviderPluginIds
            .get(event.sender.id)
            ?.get(generation)
            ?.has(providerId)
        ) {
          throw new Error(
            `capability provider "${providerId}" is quiesced for live replacement ` +
              `(consumer "${call.consumerPluginId}", generation "${generation}", ` +
              `active generation "${this.#activeRendererGenerations.get(event.sender.id) ?? "unknown"}")`,
          );
        }
        const dispatch = this.#router.dispatch(
          attachRendererChannels(call, event.sender),
        );
        this.#inFlightCalls.set(dispatch, {
          providerId,
          generation,
          senderId: event.sender.id,
        });
        let result: unknown;
        try {
          result = await dispatch;
        } finally {
          this.#inFlightCalls.delete(dispatch);
        }
        return typeof result === "function"
          ? this.#remoteDisposers.register(
              event.sender.id,
              call.consumerPluginId,
              result as () => void | Promise<void>,
            )
          : result;
      }),
    );
    ipcMain.handle(RENDERER_PROFILE_CHANNEL, (event) => {
      this.#rendererConsumers.add(event.sender.id);
      this.#issueGeneration(
        event.sender.id,
        this.#rendererProfile.generation,
      );
      this.#activeRendererGenerations.set(
        event.sender.id,
        this.#rendererProfile.generation,
      );
      return this.#rendererProfile;
    });
    ipcMain.on(RENDERER_REPLACE_RESULT_CHANNEL, (event, value: RendererReplacementResult) => {
      const pending = this.#pending.get(value?.requestId);
      if (!pending || !pending.remaining.delete(event.sender.id)) return;
      const expectedGeneration = pending.expectedGenerations.get(
        event.sender.id,
      );
      const generationIsIssued =
        typeof value.generation === "string" &&
        this.#issuedRendererGenerations
          .get(event.sender.id)
          ?.has(value.generation) === true;
      if (value.ok && value.generation !== expectedGeneration) {
        pending.errors.push(
          `renderer ${event.sender.id} acknowledged generation ${String(value.generation)}; expected ${String(expectedGeneration)}`,
        );
      } else if (!generationIsIssued) {
        pending.errors.push(
          `renderer ${event.sender.id} acknowledged an unknown generation ${String(value.generation)}`,
        );
      } else if (value.ok) {
        pending.acknowledgedGenerations.set(
          event.sender.id,
          value.generation,
        );
        this.#activeRendererGenerations.set(event.sender.id, value.generation);
      } else {
        // Failed activation restores the generation captured by the previous
        // installed ProcessTransport. Remember that actual state so rollback
        // quiesces heterogeneous windows against the right runtime.
        this.#activeRendererGenerations.set(event.sender.id, value.generation);
      }
      if (!value.ok) pending.errors.push(value.error || "renderer replacement failed");
      if (pending.remaining.size === 0) this.#finish(value.requestId, pending);
    });
    ipcMain.on(
      RENDERER_IMPACT_RESULT_CHANNEL,
      (event, value: {
        requestId?: unknown;
        ok?: unknown;
        impact?: unknown;
        error?: unknown;
      }) => {
        if (typeof value?.requestId !== "string") return;
        const pending = this.#pendingImpactInspections.get(value.requestId);
        if (!pending || !pending.remaining.delete(event.sender.id)) return;
        if (value.ok === true && value.impact && typeof value.impact === "object") {
          pending.impacts.push(value.impact as PluginRemovalImpact);
        } else {
          pending.errors.push(
            typeof value.error === "string"
              ? value.error
              : `renderer ${event.sender.id} impact inspection failed`,
          );
        }
        if (pending.remaining.size === 0) {
          this.#finishImpactInspection(value.requestId, pending);
        }
      },
    );
  }

  async inspectRendererPluginRemoval(
    pluginId: string,
    timeoutMs = 5_000,
  ): Promise<PluginRemovalImpact> {
    const consumers = [...this.#rendererConsumers].filter((id) => {
      const target = webContents.fromId(id);
      if (!target || target.isDestroyed()) {
        this.#rendererConsumers.delete(id);
        return false;
      }
      return true;
    });
    if (consumers.length === 0) return emptyRemovalImpact();
    const requestId = `renderer-impact-${Date.now()}-${++this.#sequence}`;
    return new Promise<PluginRemovalImpact>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#pendingImpactInspections.get(requestId);
        if (!pending) return;
        this.#pendingImpactInspections.delete(requestId);
        reject(
          new Error(
            `renderer impact inspection timed out for webContents ${[...pending.remaining].join(", ")}`,
          ),
        );
      }, timeoutMs);
      this.#pendingImpactInspections.set(requestId, {
        remaining: new Set(consumers),
        impacts: [],
        errors: [],
        resolve,
        reject,
        timer,
      });
      for (const id of consumers) {
        webContents.fromId(id)?.send(RENDERER_IMPACT_CHANNEL, {
          requestId,
          pluginId,
        });
      }
    });
  }

  #finishImpactInspection(
    requestId: string,
    pending: PendingImpactInspection,
  ): void {
    clearTimeout(pending.timer);
    this.#pendingImpactInspections.delete(requestId);
    if (pending.errors.length > 0) {
      pending.reject(
        new Error(`renderer impact inspection failed: ${pending.errors.join("; ")}`),
      );
      return;
    }
    pending.resolve(mergePluginRemovalImpacts(pending.impacts));
  }

  update(router: CapabilityRpcRouter, _rendererProfile: RendererBootstrapData): void {
    this.#router = router;
  }

  #withFreshGeneration(
    rendererProfile: RendererBootstrapData,
  ): RendererBootstrapData {
    return {
      ...rendererProfile,
      generation: `renderer-${randomUUID()}`,
    };
  }

  #issueGeneration(senderId: number, generation: string): void {
    const issued = this.#issuedRendererGenerations.get(senderId) ?? new Set();
    issued.add(generation);
    this.#issuedRendererGenerations.set(senderId, issued);
  }

  #trackSender(sender: Electron.WebContents): void {
    if (this.#trackedSenders.has(sender.id)) return;
    this.#trackedSenders.add(sender.id);
    sender.once("destroyed", () => {
      this.#trackedSenders.delete(sender.id);
      this.#rendererConsumers.delete(sender.id);
      this.#issuedRendererGenerations.delete(sender.id);
      this.#activeRendererGenerations.delete(sender.id);
      this.#blockedProviderPluginIds.delete(sender.id);
      void this.#remoteDisposers.releaseSender(sender.id).catch((error) => {
        console.error(
          `[plugins] renderer disposer cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });
  }

  async replaceRendererProfiles(
    rendererProfile: RendererBootstrapData,
    changedServiceNames: readonly string[] = [],
  ): Promise<void> {
    await this.#activateRendererProfiles(
      rendererProfile,
      changedServiceNames,
      15_000,
    );
  }

  /** Convergence after a failed/expired transaction may have to wait behind a
   * renderer operation that acknowledged late. The preload queue keeps the
   * restore ordered; this longer deadline never authorizes main destruction. */
  async restoreRendererProfiles(rendererProfile: RendererBootstrapData): Promise<void> {
    await this.#activateRendererProfiles(rendererProfile, [], 60_000);
  }

  async #activateRendererProfiles(
    rendererProfile: RendererBootstrapData,
    changedServiceNames: readonly string[],
    timeoutMs: number,
  ): Promise<void> {
    const pendingProfile = this.#withFreshGeneration(rendererProfile);
    // Publish before notifying existing windows so a renderer created during
    // activation boots the same pending generation and joins any convergence.
    this.#rendererProfile = pendingProfile;
    await this.#changeRendererProfiles(
      {
        phase: "activate",
        profile: pendingProfile,
        changedServiceNames: [...changedServiceNames],
      },
      timeoutMs,
    );
  }

  async quiesceRendererProfiles(
    rendererProfile: RendererBootstrapData,
    changedPluginIds: readonly string[],
    drainProviderPluginIds: readonly string[],
    changedServiceNames: readonly string[] = [],
  ): Promise<void> {
    const quiesceProfile = {
      ...rendererProfile,
      generation: this.#rendererProfile.generation,
    };
    const acknowledgedGenerations = await this.#changeRendererProfiles({
      phase: "quiesce",
      profile: quiesceProfile,
      changedPluginIds: [...changedPluginIds],
      changedServiceNames: [...changedServiceNames],
    });
    const affectedProviders = new Set(drainProviderPluginIds);
    const blockedGenerations = new Map<number, Set<string>>();
    for (const senderId of acknowledgedGenerations.keys()) {
      const generations = new Set(
        this.#issuedRendererGenerations.get(senderId) ?? [],
      );
      blockedGenerations.set(senderId, generations);
      const byGeneration =
        this.#blockedProviderPluginIds.get(senderId) ?? new Map();
      for (const generation of generations) {
        const blocked = byGeneration.get(generation) ?? new Set<string>();
        for (const providerId of affectedProviders) blocked.add(providerId);
        byGeneration.set(generation, blocked);
      }
      this.#blockedProviderPluginIds.set(senderId, byGeneration);
    }
    await this.#drainCapabilityCalls(
      affectedProviders,
      blockedGenerations,
    );
  }

  async #drainCapabilityCalls(
    providerPluginIds: ReadonlySet<string>,
    generationsBySender: ReadonlyMap<number, ReadonlySet<string>>,
  ): Promise<void> {
    while (true) {
      const affected = [...this.#inFlightCalls]
        .filter(([, call]) =>
          call.providerId !== undefined &&
          providerPluginIds.has(call.providerId) &&
          generationsBySender.get(call.senderId)?.has(call.generation) === true,
        )
        .map(([call]) => call);
      if (affected.length === 0) return;
      await Promise.allSettled(affected);
    }
  }

  async #changeRendererProfiles(
    change: RendererProfileChange,
    timeoutMs = 15_000,
  ): Promise<Map<number, string>> {
    const consumers = [...this.#rendererConsumers].filter((id) => {
      const target = webContents.fromId(id);
      if (!target || target.isDestroyed()) {
        this.#rendererConsumers.delete(id);
        return false;
      }
      return true;
    });
    if (consumers.length === 0) return new Map();
    const requestId = `renderer-${Date.now()}-${++this.#sequence}`;
    const expectedGenerations = new Map<number, string>();
    for (const senderId of consumers) {
      if (change.phase === "activate") {
        this.#issueGeneration(senderId, change.profile.generation);
        expectedGenerations.set(senderId, change.profile.generation);
      } else {
        expectedGenerations.set(
          senderId,
          this.#activeRendererGenerations.get(senderId) ??
            change.profile.generation,
        );
      }
    }
    return new Promise<Map<number, string>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        this.#pending.delete(requestId);
        reject(
          new Error(
            `renderer plugin replacement timed out for webContents ${[...pending.remaining].join(", ")}`,
          ),
        );
      }, timeoutMs);
      this.#pending.set(requestId, {
        remaining: new Set(consumers),
        errors: [],
        expectedGenerations,
        acknowledgedGenerations: new Map(),
        resolve,
        reject,
        timer,
      });
      for (const id of consumers) {
        const expectedGeneration = expectedGenerations.get(id);
        const rendererChange =
          expectedGeneration === change.profile.generation
            ? change
            : {
                ...change,
                profile: {
                  ...change.profile,
                  generation: expectedGeneration,
                },
              };
        webContents.fromId(id)?.send(RENDERER_REPLACE_CHANNEL, {
          requestId,
          change: rendererChange,
        });
      }
    });
  }

  #finish(
    requestId: string,
    pending: PendingReplacement,
  ): void {
    clearTimeout(pending.timer);
    this.#pending.delete(requestId);
    if (pending.errors.length > 0) {
      pending.reject(new Error(pending.errors.join("\n")));
    } else {
      pending.resolve(new Map(pending.acknowledgedGenerations));
    }
  }

  dispose(): void {
    ipcMain.removeHandler(CHANNEL);
    ipcMain.removeHandler(RENDERER_PROFILE_CHANNEL);
    ipcMain.removeAllListeners(RENDERER_REPLACE_RESULT_CHANNEL);
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("capability IPC host disposed"));
    }
    this.#pending.clear();
    this.#rendererConsumers.clear();
    this.#trackedSenders.clear();
    this.#inFlightCalls.clear();
    this.#issuedRendererGenerations.clear();
    this.#activeRendererGenerations.clear();
    this.#blockedProviderPluginIds.clear();
    void this.#remoteDisposers.disposeAll().catch((error) => {
      console.error(
        `[plugins] remote disposer shutdown failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}

export function registerCapabilityIpc(
  router: CapabilityRpcRouter,
  rendererProfile: RendererBootstrapData,
): CapabilityIpcHost {
  return new CapabilityIpcHost(router, rendererProfile);
}

import type {
  CapabilityRuntime,
  PluginActivationContext,
  PluginModule,
} from "./runtime";

export type LifecycleResourceSnapshot = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface PluginLifecycleCertificate {
  pluginId: string;
  effectsPerSuccessfulCycle: number;
  successfulCycles: 2;
  failurePrefixesTested: number;
  cleanupFailures: 0;
}

export interface PluginLifecycleCertificationInput {
  pluginId: string;
  /** The real compiled or source entrypoint module being certified. */
  module: PluginModule;
  /** A fresh resolved runtime with this exact plugin and its test providers. */
  createRuntime(): CapabilityRuntime | Promise<CapabilityRuntime>;
  /**
   * Inventory resources outside CapabilityRuntime (listeners, timers,
   * watchers, processes, views, streams, and provider-owned handles).
   * Returning only runtime counters is not sufficient certification.
   */
  snapshotResources():
    | LifecycleResourceSnapshot
    | Promise<LifecycleResourceSnapshot>;
}

class InjectedLifecycleFailure extends Error {
  constructor(readonly registration: number) {
    super(`injected lifecycle failure after registration ${registration}`);
  }
}

function sameSnapshot(
  expected: LifecycleResourceSnapshot,
  actual: LifecycleResourceSnapshot,
): boolean {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  return (
    expectedKeys.length === actualKeys.length &&
    expectedKeys.every(
      (key, index) =>
        key === actualKeys[index] && Object.is(expected[key], actual[key]),
    )
  );
}

function assertSnapshot(
  pluginId: string,
  phase: string,
  expected: LifecycleResourceSnapshot,
  actual: LifecycleResourceSnapshot,
): void {
  if (sameSnapshot(expected, actual)) return;
  throw new Error(
    `plugin "${pluginId}" leaked resources after ${phase}: ` +
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function failureInjectedModule(
  module: PluginModule,
  failAfterRegistration: number,
): PluginModule {
  return {
    inject: module.inject,
    optionalInject: module.optionalInject,
    replacementPolicy: module.replacementPolicy,
    async activate(context) {
      let registrations = 0;
      const afterRegistration = () => {
        registrations += 1;
        if (registrations === failAfterRegistration) {
          throw new InjectedLifecycleFailure(registrations);
        }
      };
      const instrument = (
        base: PluginActivationContext,
      ): PluginActivationContext => ({
        pluginId: base.pluginId,
        generation: base.generation,
        get: <T>(capability: string) => base.get<T>(capability),
        observe: <T>(capability: string) => base.observe<T>(capability),
        feature: (descriptor, activate) =>
          base.feature(descriptor, async (child) => {
            const cleanup = await activate(instrument(child));
            if (typeof cleanup === "function") {
              await child.effect(() => cleanup);
              afterRegistration();
            }
          }),
        entries: <T>(capability: string) => base.entries<T>(capability),
        provide: <T>(capability: string, value: T, key?: string) => {
          const dispose = base.provide(capability, value, key);
          afterRegistration();
          return dispose;
        },
        effect: async (install) => {
          const dispose = await base.effect(install);
          afterRegistration();
          return dispose;
        },
      });
      const instrumented = instrument(context);
      const cleanup = await module.activate(instrumented);
      if (typeof cleanup === "function") {
        await context.effect(() => cleanup);
        afterRegistration();
      }
    },
  };
}

function assertCleanDiagnostics(
  runtime: CapabilityRuntime,
  pluginId: string,
  phase: string,
): void {
  const diagnostics = runtime.lifecycleDiagnostics(pluginId);
  if (
    diagnostics.activeEffects !== 0 ||
    diagnostics.registrations !== diagnostics.disposals ||
    diagnostics.cleanupFailures !== 0
  ) {
    throw new Error(
      `plugin "${pluginId}" failed lifecycle accounting after ${phase}: ` +
        JSON.stringify(diagnostics),
    );
  }
}

function pluginProvidedServices(
  runtime: CapabilityRuntime,
  pluginId: string,
): string[] {
  return runtime
    .serviceProviders()
    .filter((provider) => provider.providerId === pluginId)
    .map((provider) => provider.name)
    .sort();
}

/**
 * Certify §3.4 against the real plugin entrypoint and a resource-observing
 * environment. A certificate also requires a public service or observed
 * product resource to exist while active and to be absent after deactivation.
 * It deliberately injects an activation failure after every registered prefix,
 * so a late cleanup callback cannot hide an earlier leak.
 */
export async function certifyPluginLifecycle(
  input: PluginLifecycleCertificationInput,
): Promise<PluginLifecycleCertificate> {
  const runtime = await input.createRuntime();
  const effects: number[] = [];

  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const before = await input.snapshotResources();
    const beforeDiagnostics = runtime.lifecycleDiagnostics(input.pluginId);
    await runtime.activate(input.pluginId, input.module);
    const active = runtime.lifecycleDiagnostics(input.pluginId);
    const activeResources = await input.snapshotResources();
    const activeServices = pluginProvidedServices(runtime, input.pluginId);
    if (activeServices.length === 0 && sameSnapshot(before, activeResources)) {
      throw new Error(
        `plugin "${input.pluginId}" exposed no observable product effect while active`,
      );
    }
    effects.push(active.registrations - beforeDiagnostics.registrations);
    await runtime.deactivate(input.pluginId);
    assertCleanDiagnostics(
      runtime,
      input.pluginId,
      `successful cycle ${cycle}`,
    );
    assertSnapshot(
      input.pluginId,
      `successful cycle ${cycle}`,
      before,
      await input.snapshotResources(),
    );
    const remainingServices = pluginProvidedServices(runtime, input.pluginId);
    if (remainingServices.length > 0) {
      throw new Error(
        `plugin "${input.pluginId}" left product services active after successful cycle ${cycle}: ` +
          remainingServices.join(", "),
      );
    }
  }

  if (effects[0] !== effects[1]) {
    throw new Error(
      `plugin "${input.pluginId}" registered ${effects[0]} effects in cycle 1 ` +
        `but ${effects[1]} in cycle 2`,
    );
  }

  for (let prefix = 1; prefix <= effects[0]; prefix += 1) {
    const failureRuntime = await input.createRuntime();
    const before = await input.snapshotResources();
    let failure: unknown;
    let activated = false;
    try {
      await failureRuntime.activate(
        input.pluginId,
        failureInjectedModule(input.module, prefix),
      );
      activated = true;
      failure = failureRuntime
        .inspectFeatures()
        .map((feature) => feature.error)
        .find((error) => error instanceof InjectedLifecycleFailure);
    } catch (error) {
      failure = error;
    }
    if (activated) await failureRuntime.deactivate(input.pluginId);
    if (!(failure instanceof InjectedLifecycleFailure)) {
      throw new Error(
        `plugin "${input.pluginId}" did not reach injected failure prefix ${prefix}`,
        { cause: failure },
      );
    }
    assertCleanDiagnostics(
      failureRuntime,
      input.pluginId,
      `activation failure prefix ${prefix}`,
    );
    assertSnapshot(
      input.pluginId,
      `activation failure prefix ${prefix}`,
      before,
      await input.snapshotResources(),
    );
  }

  return {
    pluginId: input.pluginId,
    effectsPerSuccessfulCycle: effects[0],
    successfulCycles: 2,
    failurePrefixesTested: effects[0],
    cleanupFailures: 0,
  };
}

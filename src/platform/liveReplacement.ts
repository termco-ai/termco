import type { ResolvedPluginTree } from "./contracts";
import {
  CapabilityRuntime,
  type LiveResourceImpact,
  type PluginModule,
} from "./runtime";

export interface ReplacementWarning {
  changedCapabilities: string[];
  impacts: LiveResourceImpact[];
  message: string;
}

function errorDetail(error: unknown): string {
  if (error instanceof AggregateError) {
    return `${error.message}: ${error.errors.map(errorDetail).join("; ")}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export type ConfirmReplacement = (
  warning: ReplacementWarning,
) => boolean | Promise<boolean>;

export interface ReplacementResult {
  status: "replaced" | "cancelled";
  warning?: ReplacementWarning;
}

export class LiveReplacementError extends Error {
  constructor(
    readonly phase:
      | "candidate-preload"
      | "candidate-activation"
      | "renderer-activation"
      | "persistence"
      | "rollback",
    readonly cause: unknown,
    readonly previousProviderRestored: boolean,
    readonly destroyedResources: LiveResourceImpact[],
  ) {
    const detail = errorDetail(cause);
    const resourceMessage = destroyedResources.some(
      (impact) => impact.resources.length > 0,
    )
      ? " Live resources were destroyed and cannot be restored."
      : "";
    super(
      `live plugin replacement failed during ${phase}: ${detail}. Previous provider ${
        previousProviderRestored ? "was restored" : "could not be restored"
      }.${resourceMessage}`,
    );
    this.name = "LiveReplacementError";
  }
}

export type ModuleLoader = (pluginId: string) => Promise<PluginModule>;

function pluginIdentity(
  tree: ResolvedPluginTree,
  pluginId: string,
): string | undefined {
  const plugin = tree.plugins.find((entry) => entry.id === pluginId);
  return plugin
    ? JSON.stringify({ manifest: plugin.manifest, source: plugin.source })
    : undefined;
}

/** Compare complete trees so process-local runtimes can restart consumers when
 * an injected provider row outside their projection changes. */
export function changedPluginIds(
  previous: ResolvedPluginTree,
  candidate: ResolvedPluginTree,
): Set<string> {
  const pluginIds = new Set([
    ...previous.plugins.map((plugin) => plugin.id),
    ...candidate.plugins.map((plugin) => plugin.id),
  ]);
  return new Set(
    [...pluginIds].filter(
      (pluginId) =>
        pluginIdentity(previous, pluginId) !==
        pluginIdentity(candidate, pluginId),
    ),
  );
}

function sameProcessTree(
  previous: ResolvedPluginTree,
  candidate: ResolvedPluginTree,
): boolean {
  const summarize = (tree: ResolvedPluginTree) => ({
    plugins: tree.plugins.map((plugin) => ({
      id: plugin.id,
      manifest: plugin.manifest,
      source: plugin.source,
    })),
    activationOrder: tree.activationOrder,
  });
  return (
    JSON.stringify(summarize(previous)) === JSON.stringify(summarize(candidate))
  );
}

async function preload(
  tree: ResolvedPluginTree,
  load: ModuleLoader,
  pluginIds: ReadonlySet<string>,
): Promise<Map<string, PluginModule>> {
  const modules = new Map<string, PluginModule>();
  for (const pluginId of tree.activationOrder) {
    if (!pluginIds.has(pluginId)) continue;
    const module = await load(pluginId);
    if (!module || typeof module.activate !== "function") {
      throw new Error(`plugin "${pluginId}" does not export activate()`);
    }
    modules.set(pluginId, module);
  }
  return modules;
}

function unchangedPluginIds(
  previous: ResolvedPluginTree,
  candidate: ResolvedPluginTree,
): Set<string> {
  const candidateById = new Map(
    candidate.plugins.map((plugin) => [plugin.id, plugin]),
  );
  return new Set(
    previous.plugins
      .filter((plugin) => {
        const next = candidateById.get(plugin.id);
        return Boolean(
          next &&
            JSON.stringify({
              manifest: plugin.manifest,
              source: plugin.source,
            }) ===
              JSON.stringify({ manifest: next.manifest, source: next.source }),
        );
      })
      .map((plugin) => plugin.id),
  );
}

function adoptablePluginIds(
  runtime: CapabilityRuntime,
  pluginIds: ReadonlySet<string>,
): Set<string> {
  const states = new Map(
    runtime.inspect().map((fiber) => [fiber.pluginId, fiber.state]),
  );
  const registered = runtime.registeredModules();
  return new Set(
    [...pluginIds].filter((pluginId) => {
      const state = states.get(pluginId);
      return (
        registered.has(pluginId) &&
        (state === "active" || state === "pending")
      );
    }),
  );
}

/** Owns the one active runtime and swaps complete, already-resolved trees. */
export class LiveGraphController {
  #runtime: CapabilityRuntime;

  constructor(runtime: CapabilityRuntime) {
    this.#runtime = runtime;
  }

  get runtime(): CapabilityRuntime {
    return this.#runtime;
  }

  async replace(
    candidateTree: ResolvedPluginTree,
    loadCandidate: ModuleLoader,
    confirm: ConfirmReplacement,
    options: {
      candidateRuntime?: CapabilityRuntime;
      externallyChangedPluginIds?: ReadonlySet<string>;
      prepareCandidateRuntime?: (
        runtime: CapabilityRuntime,
      ) => void | Promise<void>;
      prepareRollbackRuntime?: (
        runtime: CapabilityRuntime,
      ) => void | Promise<void>;
      beforeDeactivate?: () => void | Promise<void>;
      allowPendingPluginIds?: ReadonlySet<string>;
    } = {},
  ): Promise<ReplacementResult> {
    const externallyChangedPluginIds =
      options.externallyChangedPluginIds ?? new Set<string>();
    if (
      externallyChangedPluginIds.size === 0 &&
      sameProcessTree(this.#runtime.tree, candidateTree)
    ) {
      return { status: "replaced" };
    }
    const structurallyUnchanged = unchangedPluginIds(
      this.#runtime.tree,
      candidateTree,
    );
    const previousChanged = new Set([
      ...externallyChangedPluginIds,
      ...this.#runtime.tree.plugins
        .map((plugin) => plugin.id)
        .filter((pluginId) => !structurallyUnchanged.has(pluginId)),
    ]);
    const candidateChanged = new Set(
      candidateTree.plugins
        .map((plugin) => plugin.id)
        .filter((pluginId) => !structurallyUnchanged.has(pluginId)),
    );
    const previousPluginIds = new Set(
      this.#runtime.tree.plugins.map((plugin) => plugin.id),
    );
    // The previous live generation is authoritative for captured service
    // objects. Follow executable `inject` edges from the providers that are
    // changing instead of consulting manifest capability metadata.
    const transactionAffected = new Set([
      ...this.#runtime.dependencyClosedPluginIds(
        previousChanged,
      ),
      ...candidateChanged,
    ]);
    const candidatePluginIds = new Set(
      candidateTree.plugins.map((plugin) => plugin.id),
    );
    const previousTransactionAffected = new Set(
      [...transactionAffected].filter((pluginId) =>
        previousPluginIds.has(pluginId),
      ),
    );
    const candidateTransactionAffected = new Set(
      [...transactionAffected].filter((pluginId) =>
        candidatePluginIds.has(pluginId),
      ),
    );
    const preserved = new Set(
      [...structurallyUnchanged].filter(
        (pluginId) => !transactionAffected.has(pluginId),
      ),
    );
    let candidateModules: Map<string, PluginModule>;
    try {
      candidateModules = await preload(
        candidateTree,
        loadCandidate,
        candidateTransactionAffected,
      );
    } catch (error) {
      throw new LiveReplacementError("candidate-preload", error, true, []);
    }

    const previousTree = this.#runtime.tree;
    const previousModules = this.#runtime.registeredModules();
    const previousPendingPluginIds = new Set(
      this.#runtime
        .inspect()
        .filter((fiber) => fiber.state === "pending")
        .map((fiber) => fiber.pluginId),
    );
    // Only the dependency-closed affected slice is stopped. Unrelated provider
    // instances and their live resources remain active throughout the swap.
    const impacts: LiveResourceImpact[] = [];
    for (const pluginId of previousTree.activationOrder) {
      if (!previousTransactionAffected.has(pluginId)) continue;
      impacts.push(...(await this.#runtime.replacementImpact(pluginId)));
    }
    const changedCapabilities = [
      ...new Set(impacts.map((impact) => impact.capability)),
    ].sort();

    let warning: ReplacementWarning | undefined;
    if (
      changedCapabilities.length > 0 ||
      impacts.some((impact) => impact.resources.length > 0)
    ) {
      const count = impacts.reduce(
        (total, impact) => total + impact.resources.length,
        0,
      );
      warning = {
        changedCapabilities,
        impacts,
        message:
          count > 0
            ? `This live graph replacement will destroy ${count} live resource${count === 1 ? "" : "s"}. They cannot be restored.`
            : `Replacing ${changedCapabilities.join(", ")} will stop the current provider before starting the new one.`,
      };
      if (!(await confirm(warning))) return { status: "cancelled", warning };
    }

    // Zero overlap for affected providers; unchanged instances move into the
    // successor runtime without activation, cleanup, or duplicated state.
    try {
      await options.beforeDeactivate?.();
    } catch (error) {
      throw new LiveReplacementError(
        "candidate-activation",
        error,
        true,
        impacts,
      );
    }
    try {
      await this.#runtime.deactivatePlugins(previousTransactionAffected);
    } catch (deactivationError) {
      const restored = new CapabilityRuntime(previousTree);
      restored.adoptRegisteredPluginsFrom(this.#runtime, preserved);
      try {
        await options.prepareRollbackRuntime?.(restored);
        await restored.activatePlugins(
          previousTransactionAffected,
          async (pluginId) => {
            const module = previousModules.get(pluginId);
            if (!module) {
              throw new Error(`previous module "${pluginId}" is unavailable`);
            }
            return module;
          },
        );
        restored.assertSettled({
          allowPendingPluginIds: previousPendingPluginIds,
        });
        this.#runtime = restored;
      } catch (rollbackError) {
        this.#runtime = restored;
        throw new LiveReplacementError(
          "rollback",
          new AggregateError(
            [deactivationError, rollbackError],
            "provider deactivation failed and rollback failed",
          ),
          false,
          impacts,
        );
      }
      throw new LiveReplacementError(
        "candidate-activation",
        deactivationError,
        true,
        impacts,
      );
    }
    const candidateRuntime =
      options.candidateRuntime ?? new CapabilityRuntime(candidateTree);
    if (candidateRuntime.tree !== candidateTree) {
      throw new Error(
        "candidate runtime does not belong to the candidate tree",
      );
    }
    candidateRuntime.adoptRegisteredPluginsFrom(this.#runtime, preserved);
    try {
      await options.prepareCandidateRuntime?.(candidateRuntime);
      await candidateRuntime.activatePlugins(
        candidateTransactionAffected,
        async (pluginId) => {
          const module = candidateModules.get(pluginId);
          if (!module) {
            throw new Error(`candidate module "${pluginId}" was not preloaded`);
          }
          return module;
        },
      );
      candidateRuntime.assertSettled({
        allowPendingPluginIds: options.allowPendingPluginIds,
      });
      this.#runtime = candidateRuntime;
      return { status: "replaced", ...(warning ? { warning } : {}) };
    } catch (candidateError) {
      await candidateRuntime.deactivatePlugins(candidateTransactionAffected);
      const restored = new CapabilityRuntime(previousTree);
      const stillAdoptable = adoptablePluginIds(candidateRuntime, preserved);
      restored.adoptRegisteredPluginsFrom(candidateRuntime, stillAdoptable);
      const needsReactivation = new Set([
        ...previousTransactionAffected,
        ...[...preserved].filter(
          (pluginId) =>
            previousPluginIds.has(pluginId) && !stillAdoptable.has(pluginId),
        ),
      ]);
      try {
        await options.prepareRollbackRuntime?.(restored);
        await restored.activatePlugins(
          needsReactivation,
          async (pluginId) => {
            const module = previousModules.get(pluginId);
            if (!module) {
              throw new Error(`previous module "${pluginId}" is unavailable`);
            }
            return module;
          },
        );
        restored.assertSettled({
          allowPendingPluginIds: previousPendingPluginIds,
        });
        this.#runtime = restored;
      } catch (rollbackError) {
        this.#runtime = restored;
        throw new LiveReplacementError(
          "rollback",
          new AggregateError(
            [candidateError, rollbackError],
            "candidate activation failed and rollback failed",
          ),
          false,
          impacts,
        );
      }
      throw new LiveReplacementError(
        "candidate-activation",
        candidateError,
        true,
        impacts,
      );
    }
  }
}

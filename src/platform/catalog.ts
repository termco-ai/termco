import type {
  CapabilityCatalogItem,
  PluginCatalogItem,
} from "@termco/profile-base";
import type { ComposedProfile } from "./composeProfile";
import type { ProfilePluginRowV3, ResolvedPluginTree } from "./contracts";
import type {
  CapabilityRuntime,
  RuntimeFeatureInspection,
  RuntimeFiberInspection,
} from "./runtime";
import {
  describePluginSource,
  isPluginLocationWithin,
} from "./sourceDescriptor";

export type {
  CapabilityCatalogItem,
  PluginCatalogItem,
} from "@termco/profile-base";

export interface ServiceCatalogMetadata {
  version?: string;
  description?: string;
  cardinality?: CapabilityCatalogItem["cardinality"];
}

/** Host-only state carried alongside the frozen public catalog contract. */
export type RuntimePluginCatalogItem = PluginCatalogItem & {
  profileRowId: string;
  enabled: boolean;
  essentialReason?: string;
  profileRelation?: "inherited" | "installed" | "fork" | "replacement";
  forkedFrom?: string;
};

/** Runtime and plugin-owned observations used only to build explanatory UI. */
export interface PluginCatalogObservations {
  /** Actual runtime service name to stable provider row identities. */
  serviceProviders: ReadonlyMap<string, readonly string[]>;
  /** Executable PluginModule.inject dependencies by stable row identity. */
  moduleInjections: ReadonlyMap<string, readonly string[]>;
  optionalModuleInjections?: ReadonlyMap<string, readonly string[]>;
  runtime?: {
    process: string;
    fibers: readonly RuntimeFiberInspection[];
    features: readonly RuntimeFeatureInspection[];
  };
  serviceMetadata?: ReadonlyMap<string, ServiceCatalogMetadata>;
  privilegeLabels?: ReadonlyMap<
    string,
    readonly PluginCatalogItem["permissions"][number][]
  >;
}

function serviceItem(
  service: string,
  observations: PluginCatalogObservations,
): CapabilityCatalogItem {
  const metadata = observations.serviceMetadata?.get(service);
  return {
    id: service,
    version: metadata?.version ?? "runtime",
    description: metadata?.description ?? "Plugin-owned runtime service.",
    cardinality: metadata?.cardinality ?? "exclusive",
    providers: [...(observations.serviceProviders.get(service) ?? [])],
  };
}

/** Build the self-describing Plugin Manager read model. Observations explain
 * current runtime state; none of this metadata participates in authorization. */
export function buildPluginCatalog(
  profile: ComposedProfile,
  tree: ResolvedPluginTree,
  observations: PluginCatalogObservations,
  options: {
    userPluginsRoot?: string;
    manifests?: ReadonlyMap<
      string,
      import("./contracts").TermcoPluginManifestV3
    >;
    essentialReasons?: ReadonlyMap<string, string>;
  } = {},
): RuntimePluginCatalogItem[] {
  const activeByRow = new Map(
    tree.plugins.map((plugin) => [plugin.id, plugin]),
  );
  const rows: readonly ProfilePluginRowV3[] = options.manifests
    ? profile.plugins
    : tree.plugins.map((plugin) => ({
        id: plugin.id,
        module: plugin.source.module,
      }));
  return rows
    .flatMap((row): RuntimePluginCatalogItem[] => {
      const activePlugin = activeByRow.get(row.id);
      const manifest = activePlugin?.manifest ?? options.manifests?.get(row.id);
      if (!manifest?.entrypoints) return [];
      const source = activePlugin?.source ?? describePluginSource(row.module);
      const enabled = row.enabled !== false && activePlugin !== undefined;
      const selectedBy = profile.provenance[row.id] ?? profile.id;
      const userInstalled = Boolean(
        source.type === "local" &&
          source.mutable === true &&
          options.userPluginsRoot &&
          isPluginLocationWithin(options.userPluginsRoot, source.location),
      );
      const provides = [...observations.serviceProviders]
        .filter(([, providers]) => providers.includes(row.id))
        .map(([service]) => serviceItem(service, observations))
        .sort((left, right) => left.id.localeCompare(right.id));
      const consumes = [
        ...new Set([
          ...(observations.moduleInjections.get(row.id) ?? []),
          ...(observations.optionalModuleInjections?.get(row.id) ?? []),
        ]),
      ]
        .map((service) => ({
          ...serviceItem(service, observations),
          ...(observations.optionalModuleInjections?.get(row.id)?.includes(service)
            ? { optional: true }
            : {}),
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const fiber = observations.runtime?.fibers.find(
        (candidate) => candidate.pluginId === row.id,
      );
      const runtime = fiber
        ? [
            {
              process: observations.runtime?.process ?? "unknown",
              state: fiber.state,
              missingServices: [...(fiber.missingServices ?? [])],
              features: (observations.runtime?.features ?? [])
                .filter((feature) => feature.pluginId === row.id)
                .map((feature) => ({
                  id: feature.featureId,
                  label: feature.label,
                  state: feature.state,
                  missingServices: [...feature.missingServices],
                })),
            },
          ]
        : [];
      const status = !enabled
        ? "disabled"
        : fiber?.state === "failed"
          ? "failed"
          : fiber?.state === "pending"
            ? "blocked"
            : runtime.some((entry) =>
                entry.features.some((feature) => feature.state !== "active"),
              )
              ? "active-reduced"
              : "active";
      return [
        {
          id: manifest.id,
          profileRowId: row.id,
          name: manifest.name,
          description: manifest.description,
          category: manifest.category,
          version: manifest.version,
          sourceFolder: source.location,
          sourceType: source.type === "file" ? "local" : source.type,
          editable:
            source.type === "local" ||
            source.type === "file" ||
            source.mutable === true,
          userInstalled,
          profileRelation: manifest.replaces
            ? "replacement"
            : manifest.forkedFrom
              ? "fork"
              : userInstalled
                ? "installed"
                : "inherited",
          enabled,
          ...(options.essentialReasons?.get(row.id)
            ? { essentialReason: options.essentialReasons.get(row.id) }
            : {}),
          selectedBy,
          whyLoaded: !enabled
            ? `Profile layer “${selectedBy}” keeps this plugin disabled.`
            : manifest.replaces
              ? `Profile layer “${selectedBy}” selected this as a complete replacement for “${manifest.replaces}”.`
              : manifest.forkedFrom
                ? `Profile layer “${selectedBy}” selected this independent fork of “${manifest.forkedFrom}”.`
              : `Profile layer “${selectedBy}” selected this plugin.`,
          ...(manifest.forkedFrom ? { forkedFrom: manifest.forkedFrom } : {}),
          ...(manifest.replaces ? { replaces: manifest.replaces } : {}),
          provides,
          consumes,
          permissions: [...(observations.privilegeLabels?.get(row.id) ?? [])],
          processes: Object.keys(manifest.entrypoints ?? {}),
          status,
          runtime,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.name.localeCompare(right.name),
    );
}

/** Merge one process runtime into an already self-describing catalog. This is
 * used by the renderer after activation, where executable module metadata is
 * known but the host-owned profile rows remain authoritative. */
export function overlayRuntimeCatalog(
  catalog: readonly RuntimePluginCatalogItem[],
  runtime: CapabilityRuntime,
  process: string,
): RuntimePluginCatalogItem[] {
  const providers = runtime.serviceProviders();
  const modules = runtime.registeredModules();
  const fibers = new Map(runtime.inspect().map((fiber) => [fiber.pluginId, fiber]));
  const features = runtime.inspectFeatures();
  return catalog.map((plugin) => {
    const module = modules.get(plugin.profileRowId) ?? modules.get(plugin.id);
    const fiber = fibers.get(plugin.profileRowId) ?? fibers.get(plugin.id);
    const localProvides = providers
      .filter((provider) => provider.providerId === plugin.profileRowId || provider.providerId === plugin.id)
      .map((provider) => provider.name);
    const existingById = new Map(plugin.provides.map((item) => [item.id, item]));
    for (const service of localProvides) {
      const previous = existingById.get(service);
      existingById.set(service, previous ?? {
        id: service,
        version: "runtime",
        description: "Plugin-owned runtime service.",
        cardinality: "exclusive",
        providers: [plugin.id],
      });
    }
    const consumesById = new Map(plugin.consumes.map((item) => [item.id, item]));
    for (const service of module?.inject ?? []) {
      consumesById.set(service, consumesById.get(service) ?? {
        id: service,
        version: "runtime",
        description: "Plugin-owned runtime service.",
        cardinality: "exclusive",
        providers: providers
          .filter((provider) => provider.name === service)
          .map((provider) => provider.providerId),
      });
    }
    for (const service of module?.optionalInject ?? []) {
      consumesById.set(service, {
        ...(consumesById.get(service) ?? {
          id: service,
          version: "runtime",
          description: "Plugin-owned runtime service.",
          cardinality: "exclusive" as const,
          providers: providers
            .filter((provider) => provider.name === service)
            .map((provider) => provider.providerId),
        }),
        optional: true,
      });
    }
    const processState = fiber
      ? {
          process,
          state: fiber.state,
          missingServices: [...(fiber.missingServices ?? [])],
          features: features
            .filter((feature) => feature.pluginId === fiber.pluginId)
            .map((feature) => ({
              id: feature.featureId,
              label: feature.label,
              state: feature.state,
              missingServices: [...feature.missingServices],
            })),
        }
      : undefined;
    const runtimeStates = [
      ...(plugin.runtime ?? []).filter((entry) => entry.process !== process),
      ...(processState ? [processState] : []),
    ];
    const status = plugin.enabled === false
      ? "disabled"
      : runtimeStates.some((entry) => entry.state === "failed")
        ? "failed"
        : runtimeStates.some((entry) => entry.state === "pending")
          ? "blocked"
          : runtimeStates.some((entry) =>
              entry.features.some((feature) => feature.state !== "active"),
            )
            ? "active-reduced"
            : "active";
    return {
      ...plugin,
      provides: [...existingById.values()].sort((left, right) => left.id.localeCompare(right.id)),
      consumes: [...consumesById.values()].sort((left, right) => left.id.localeCompare(right.id)),
      runtime: runtimeStates,
      status,
    };
  });
}

export const PLUGIN_MANIFEST_VERSION = 3 as const;
export const PROFILE_SCHEMA_VERSION = 3 as const;

export interface PluginEntrypoints {
  renderer?: string;
  main?: string;
  utility?: string;
}

export interface PluginAssetBuild {
  /** Source entry owned by this plugin. */
  entry: string;
  /** Generated path inside the compiled cache; must begin with assets/. */
  output: string;
  platform: "node" | "browser";
  target?: string;
}

/** Source and package metadata. Runtime service declarations live in code. */
export interface TermcoPluginManifestV3 {
  schemaVersion: typeof PLUGIN_MANIFEST_VERSION;
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  /** Contract-only packages omit entrypoints and are not mounted as Fibers. */
  entrypoints?: PluginEntrypoints;
  assetBuilds?: PluginAssetBuild[];
  /** Third-party and public contract packages imported by this plugin. */
  dependencies: Record<string, string>;
  activation?: "eager" | "lazy";
  /** The source package this independent derivative was copied from. */
  forkedFrom?: string;
  /** The package this plugin intentionally and completely substitutes. */
  replaces?: string;
}

export interface ProfilePluginRowV3 {
  /** Stable row identity used by later patches and live replacement. */
  id: string;
  module: string;
  enabled?: boolean;
  /** Present only when this row was disabled by a selected replacement. */
  disabledBy?: string;
}

export interface ProfileInsertPatchV3 {
  op: "insert";
  plugin: ProfilePluginRowV3;
  before?: string;
  after?: string;
}

export interface ProfileDisablePatchV3 {
  op: "disable";
  target: string;
}

export interface ProfileRemovePatchV3 {
  op: "remove";
  target: string;
}

export interface ProfileReplacePatchV3 {
  op: "replace";
  target: string;
  plugin: ProfilePluginRowV3;
}

export type ProfilePatchV3 =
  | ProfileInsertPatchV3
  | ProfileDisablePatchV3
  | ProfileRemovePatchV3
  | ProfileReplacePatchV3;

/** Ordered source configuration; service availability is settled at runtime. */
export interface TermcoProfileV3 {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  id: string;
  bundles: string[];
  plugins: ProfilePluginRowV3[];
  patches: ProfilePatchV3[];
}

/** The generic module source selected by one stable profile row. */
export interface ResolvedPluginSource {
  type: "bundled" | "local" | "file" | "package";
  module: string;
  location: string;
  integrity?: string;
  mutable?: boolean;
}

/** One executable row in the effective profile tree. */
export interface ResolvedPlugin {
  /** Stable profile row identity; it is intentionally independent of package id. */
  id: string;
  manifest: TermcoPluginManifestV3;
  source: ResolvedPluginSource;
}

/** Ordered runtime-bearing rows. Contract-only packages are discovered but omitted. */
export interface ResolvedPluginTree {
  profileId: string;
  plugins: ResolvedPlugin[];
  activationOrder: string[];
}

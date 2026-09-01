import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { unzipSync } from "fflate";
import type {
  ProfilePluginRowV3,
  TermcoPluginManifestV3,
  TermcoProfileV3,
} from "../../../src/platform/contracts";
import type {
  PluginReleaseCheckResult,
  PluginReleaseInstallResult,
  PluginReleaseUpdate,
  PluginReleaseUpdateItem,
  PluginUpdateProgress,
} from "../../../plugin-repository/plugins/application-base/src/updater";
import { parsePluginManifestV3 } from "../../../src/platform/manifest";
import { parseProfileV3 } from "../../../src/platform/profile";
import { describePluginSource } from "../../../src/platform/sourceCatalog";
import {
  assertArchiveIntegrity,
  canonicalJson,
  compareStableVersions,
  parseAndVerifyPluginCatalog,
  parseAndVerifyPluginRelease,
  PLUGIN_CATALOG_MANIFEST_ASSET,
  PLUGIN_RELEASE_MANIFEST_ASSET,
  type PluginCatalogManifest,
  type PluginReleaseItem,
  type PluginReleaseManifest,
} from "./pluginRelease";

const STATE_SCHEMA_VERSION = 1 as const;
const MAX_ARCHIVE_FILES = 20_000;
const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024;

export interface PluginReleaseConfiguration {
  enabled: boolean;
  repository: string;
  publicKeys: Readonly<Record<string, string>>;
  apiBaseUrl?: string;
  token?: string;
}

export interface PluginReleasePaths {
  stagingRoot: string;
  officialPluginsRoot: string;
  cacheRoot: string;
  stateFile: string;
}

export interface PluginReleaseRuntimeSnapshot {
  profile: TermcoProfileV3;
  manifests: ReadonlyMap<string, TermcoPluginManifestV3>;
}

export interface PluginReleaseRuntimeHost {
  currentApplicationVersion(): string;
  snapshot(): PluginReleaseRuntimeSnapshot;
  compile(pluginRoot: string, cacheRoot: string): Promise<{
    manifest: TermcoPluginManifestV3;
    integrity: string;
  }>;
  activate(profile: TermcoProfileV3): Promise<{
    status: "replaced" | "cancelled";
    warning?: { message: string };
  }>;
}

export type PluginReleaseDisplayItem = PluginReleaseUpdateItem;
export type PluginReleaseDisplay = PluginReleaseUpdate;

export interface GitHubReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

interface PendingRelease {
  manifest: PluginReleaseManifest;
  catalog?: PluginCatalogManifest;
  baselineProfileId: string;
  display: PluginReleaseDisplay;
}

interface InstalledPluginRelease {
  releaseId: string;
  installedAt: string;
  profileBefore: TermcoProfileV3;
  profileAfterId: string;
  pluginIds: string[];
}

interface PluginReleaseState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  activeReleaseId?: string;
  history: InstalledPluginRelease[];
}

function emptyState(): PluginReleaseState {
  return { schemaVersion: STATE_SCHEMA_VERSION, history: [] };
}

function snapshotProfile(profile: TermcoProfileV3): TermcoProfileV3 {
  return structuredClone({
    schemaVersion: profile.schemaVersion,
    id: profile.id,
    bundles: profile.bundles,
    plugins: profile.plugins,
    patches: profile.patches,
  });
}

function rollbackProfile(profile: TermcoProfileV3): TermcoProfileV3 {
  return {
    ...snapshotProfile(profile),
    id: `termco.rollback.${Date.now()}.${randomUUID().slice(0, 8)}`,
  };
}

function parseGitHubRelease(value: unknown): GitHubRelease {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("plugin release feed returned an invalid GitHub release");
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.tag_name !== "string" ||
    typeof input.draft !== "boolean" ||
    typeof input.prerelease !== "boolean" ||
    !Array.isArray(input.assets)
  ) {
    throw new Error("plugin release feed is missing GitHub release metadata");
  }
  const assets = input.assets.map((asset, index): GitHubReleaseAsset => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      throw new Error(`plugin release asset ${index} is invalid`);
    }
    const candidate = asset as Record<string, unknown>;
    if (
      typeof candidate.name !== "string" ||
      !Number.isSafeInteger(candidate.size) ||
      typeof candidate.browser_download_url !== "string"
    ) {
      throw new Error(`plugin release asset ${index} is incomplete`);
    }
    return {
      name: candidate.name,
      size: candidate.size as number,
      browser_download_url: candidate.browser_download_url,
    };
  });
  return {
    tag_name: input.tag_name,
    draft: input.draft,
    prerelease: input.prerelease,
    assets,
  };
}

function releaseAsset(release: GitHubRelease, name: string): GitHubReleaseAsset {
  const matches = release.assets.filter((asset) => asset.name === name);
  if (matches.length !== 1) {
    throw new Error(
      `plugin release must contain exactly one "${name}" asset`,
    );
  }
  return matches[0] as GitHubReleaseAsset;
}

function optionalReleaseAsset(
  release: GitHubRelease,
  name: string,
): GitHubReleaseAsset | undefined {
  const matches = release.assets.filter((asset) => asset.name === name);
  if (matches.length > 1) {
    throw new Error(`plugin release contains duplicate "${name}" assets`);
  }
  return matches[0];
}

function validConfiguration(configuration: PluginReleaseConfiguration): boolean {
  return Boolean(
    configuration.enabled &&
      /^[^/\s]+\/[^/\s]+$/.test(configuration.repository) &&
      Object.keys(configuration.publicKeys).length > 0,
  );
}

function authHeaders(configuration: PluginReleaseConfiguration): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Termco-Plugin-Updater",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(configuration.token
      ? { Authorization: `Bearer ${configuration.token}` }
      : {}),
  };
}

async function responseBytes(
  response: Response,
  label: string,
  maximumBytes: number,
  onProgress?: (received: number) => void,
): Promise<Uint8Array> {
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`${label} exceeds the ${maximumBytes} byte limit`);
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new Error(`${label} exceeds the ${maximumBytes} byte limit`);
    }
    onProgress?.(bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds the ${maximumBytes} byte limit`);
    }
    onProgress?.(length);
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  const bytes = await responseBytes(response, label, 1024 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(error)}`);
  }
}

export interface LatestPluginRelease {
  manifest: PluginReleaseManifest;
  compatible: boolean;
  archiveAsset: GitHubReleaseAsset;
  catalog?: PluginCatalogManifest;
  pluginAssets?: ReadonlyMap<string, GitHubReleaseAsset>;
}

/** Resolve and authenticate the latest stable release without depending on an
 * active plugin runtime. First-launch provisioning and live updates share this
 * exact trust path. */
export async function fetchLatestPluginRelease(input: {
  configuration: PluginReleaseConfiguration;
  currentApplicationVersion: string;
  fetch?: typeof fetch;
}): Promise<LatestPluginRelease> {
  if (!validConfiguration(input.configuration)) {
    throw new Error("plugin release feed is not configured");
  }
  const request = input.fetch ?? fetch;
  const apiBaseUrl = (
    input.configuration.apiBaseUrl ?? "https://api.github.com"
  ).replace(/\/$/, "");
  const releaseResponse = await request(
    `${apiBaseUrl}/repos/${input.configuration.repository}/releases/latest`,
    { headers: authHeaders(input.configuration) },
  );
  const release = parseGitHubRelease(
    await responseJson(releaseResponse, "plugin release check"),
  );
  if (release.draft || release.prerelease) {
    throw new Error("latest plugin release is not stable");
  }
  const manifestAsset = releaseAsset(release, PLUGIN_RELEASE_MANIFEST_ASSET);
  const manifestResponse = await request(manifestAsset.browser_download_url, {
    headers: authHeaders(input.configuration),
  });
  const verified = parseAndVerifyPluginRelease(
    await responseJson(manifestResponse, "plugin release manifest download"),
    {
      currentApplicationVersion: input.currentApplicationVersion,
      publicKeys: input.configuration.publicKeys,
    },
  );
  if (release.tag_name !== verified.manifest.releaseId) {
    throw new Error("plugin release tag does not match the signed release id");
  }
  if (verified.manifest.revokedReleaseIds.includes(verified.manifest.releaseId)) {
    throw new Error("latest plugin release revokes itself");
  }
  const archiveAsset = releaseAsset(release, verified.manifest.archive.assetName);
  if (archiveAsset.size !== verified.manifest.archive.size) {
    throw new Error("GitHub archive size does not match the signed manifest");
  }
  const catalogAsset = optionalReleaseAsset(release, PLUGIN_CATALOG_MANIFEST_ASSET);
  let catalog: PluginCatalogManifest | undefined;
  let pluginAssets: ReadonlyMap<string, GitHubReleaseAsset> | undefined;
  if (catalogAsset) {
    const catalogResponse = await request(catalogAsset.browser_download_url, {
      headers: authHeaders(input.configuration),
    });
    const verifiedCatalog = parseAndVerifyPluginCatalog(
      await responseJson(catalogResponse, "plugin catalog download"),
      {
        currentApplicationVersion: input.currentApplicationVersion,
        publicKeys: input.configuration.publicKeys,
      },
    );
    const catalogBaseItems = verifiedCatalog.manifest.plugins.map(
      ({ artifact: _artifact, ...item }) => item,
    );
    if (
      verifiedCatalog.manifest.releaseId !== verified.manifest.releaseId ||
      verifiedCatalog.compatible !== verified.compatible ||
      canonicalJson(verifiedCatalog.manifest.application) !==
        canonicalJson(verified.manifest.application) ||
      canonicalJson(verifiedCatalog.manifest.revokedReleaseIds) !==
        canonicalJson(verified.manifest.revokedReleaseIds) ||
      canonicalJson(catalogBaseItems) !== canonicalJson(verified.manifest.plugins)
    ) {
      throw new Error("plugin catalog does not match the signed release manifest");
    }
    const assets = new Map<string, GitHubReleaseAsset>();
    for (const plugin of verifiedCatalog.manifest.plugins) {
      const asset = releaseAsset(release, plugin.artifact.assetName);
      if (asset.size !== plugin.artifact.size) {
        throw new Error(
          `GitHub artifact size for "${plugin.id}" does not match the signed catalog`,
        );
      }
      assets.set(plugin.id, asset);
    }
    catalog = verifiedCatalog.manifest;
    pluginAssets = assets;
  }
  return {
    manifest: verified.manifest,
    compatible: verified.compatible,
    archiveAsset,
    ...(catalog ? { catalog } : {}),
    ...(pluginAssets ? { pluginAssets } : {}),
  };
}

export async function downloadPluginReleaseArchive(input: {
  configuration: PluginReleaseConfiguration;
  release: LatestPluginRelease;
  fetch?: typeof fetch;
}): Promise<Uint8Array> {
  const response = await (input.fetch ?? fetch)(
    input.release.archiveAsset.browser_download_url,
    { headers: authHeaders(input.configuration) },
  );
  const bytes = await responseBytes(
    response,
    "plugin release archive download",
    input.release.manifest.archive.size,
  );
  assertArchiveIntegrity(bytes, input.release.manifest.archive);
  return bytes;
}

function rowForPlugin(
  snapshot: PluginReleaseRuntimeSnapshot,
  pluginId: string,
): { row: ProfilePluginRowV3; manifest: TermcoPluginManifestV3 } | undefined {
  for (const row of snapshot.profile.plugins) {
    const manifest = snapshot.manifests.get(row.id);
    if (row.id === pluginId || manifest?.id === pluginId) {
      return manifest ? { row, manifest } : undefined;
    }
  }
  return undefined;
}

function isOfficialSource(row: ProfilePluginRowV3): boolean {
  return row.module.startsWith("bundled:") || row.module.startsWith("official:");
}

function displayRelease(
  manifest: PluginReleaseManifest,
  snapshot: PluginReleaseRuntimeSnapshot,
  items: readonly PluginReleaseItem[] = manifest.plugins,
  skipped: ReadonlyArray<PluginReleaseItem & { reason: string }> = [],
): PluginReleaseDisplay {
  const displayItem = (plugin: PluginReleaseItem): PluginReleaseUpdateItem => ({
    ...plugin,
    currentVersion: rowForPlugin(snapshot, plugin.id)?.manifest.version ?? null,
  });
  return {
    releaseId: manifest.releaseId,
    publishedAt: manifest.publishedAt,
    plugins: items.map(displayItem),
    ...(skipped.length > 0
      ? {
          skipped: skipped.map((plugin) => ({
            ...displayItem(plugin),
            reason: plugin.reason,
          })),
        }
      : {}),
  };
}

function releaseNeed(
  manifest: PluginReleaseManifest,
  snapshot: PluginReleaseRuntimeSnapshot,
): {
  needed: PluginReleaseItem[];
  skipped: Array<PluginReleaseItem & { reason: string }>;
  blockedReason?: string;
} {
  const needed: PluginReleaseItem[] = [];
  const skipped: Array<PluginReleaseItem & { reason: string }> = [];
  for (const plugin of manifest.plugins) {
    const current = rowForPlugin(snapshot, plugin.id);
    if (!current) {
      needed.push(plugin);
      continue;
    }
    const comparison = compareStableVersions(plugin.version, current.manifest.version);
    if (comparison < 0) {
      return {
        needed: [],
        skipped,
        blockedReason:
          `${plugin.name} ${plugin.version} is older than the installed ${current.manifest.version}.`,
      };
    }
    if (comparison === 0) continue;
    if (!isOfficialSource(current.row)) {
      skipped.push({
        ...plugin,
        reason: "A customized source is active, so this plugin was left untouched.",
      });
      continue;
    }
    needed.push(plugin);
  }
  return { needed, skipped };
}

function safeArchivePath(name: string): string {
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`plugin release archive path escapes staging: ${name}`);
  }
  return normalized.replace(/^\.\//, "");
}

export async function extractPluginReleaseArchive(
  bytes: Uint8Array,
  target: string,
): Promise<void> {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  if (names.length === 0 || names.length > MAX_ARCHIVE_FILES) {
    throw new Error("plugin release archive contains an unsupported file count");
  }
  let extractedBytes = 0;
  for (const [rawName, data] of Object.entries(entries)) {
    const name = safeArchivePath(rawName);
    if (!name || name.endsWith("/")) continue;
    if (!name.startsWith("plugins/")) {
      throw new Error(`plugin release archive contains an unexpected path: ${name}`);
    }
    extractedBytes += data.byteLength;
    if (extractedBytes > MAX_EXTRACTED_BYTES) {
      throw new Error("plugin release archive exceeds the extraction limit");
    }
    const destination = resolve(target, name);
    const targetRelative = relative(target, destination);
    if (
      targetRelative === "" ||
      targetRelative.startsWith("..") ||
      isAbsolute(targetRelative)
    ) {
      throw new Error(`plugin release archive path escapes staging: ${name}`);
    }
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.writeFile(destination, data, { flag: "wx" });
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

async function readState(file: string): Promise<PluginReleaseState> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("state must be an object");
    }
    const input = value as Partial<PluginReleaseState>;
    if (
      input.schemaVersion !== STATE_SCHEMA_VERSION ||
      !Array.isArray(input.history) ||
      (input.activeReleaseId !== undefined &&
        typeof input.activeReleaseId !== "string")
    ) {
      throw new Error("state schema is invalid");
    }
    const history = input.history.map((value, index): InstalledPluginRelease => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`state history entry ${index} is invalid`);
      }
      const candidate = value as Partial<InstalledPluginRelease>;
      const profile = parseProfileV3(candidate.profileBefore);
      if (
        typeof candidate.releaseId !== "string" ||
        typeof candidate.installedAt !== "string" ||
        !Number.isFinite(Date.parse(candidate.installedAt)) ||
        typeof candidate.profileAfterId !== "string" ||
        !Array.isArray(candidate.pluginIds) ||
        candidate.pluginIds.some((pluginId) => typeof pluginId !== "string") ||
        !profile.ok
      ) {
        throw new Error(`state history entry ${index} is invalid`);
      }
      return {
        releaseId: candidate.releaseId,
        installedAt: candidate.installedAt,
        profileBefore: profile.profile,
        profileAfterId: candidate.profileAfterId,
        pluginIds: candidate.pluginIds as string[],
      };
    });
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      ...(input.activeReleaseId
        ? { activeReleaseId: input.activeReleaseId }
        : {}),
      history,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw new Error(`cannot read plugin release state: ${String(error)}`);
  }
}

async function sameCompiledGeneration(left: string, right: string): Promise<boolean> {
  try {
    const [leftIntegrity, rightIntegrity] = await Promise.all([
      fs.readFile(join(left, "integrity.txt"), "utf8"),
      fs.readFile(join(right, "integrity.txt"), "utf8"),
    ]);
    return leftIntegrity.trim() === rightIntegrity.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function installCompiledPluginGeneration(
  stagedRoot: string,
  finalRoot: string,
): Promise<void> {
  try {
    await fs.lstat(finalRoot);
    if (!(await sameCompiledGeneration(stagedRoot, finalRoot))) {
      throw new Error(
        `compiled plugin version already exists with different integrity at ${finalRoot}`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await fs.mkdir(dirname(finalRoot), { recursive: true });
    await fs.rename(stagedRoot, finalRoot);
  }
}

export class PluginReleaseManager {
  readonly #configuration: PluginReleaseConfiguration;
  readonly #paths: PluginReleasePaths;
  readonly #host: PluginReleaseRuntimeHost;
  readonly #fetch: typeof fetch;
  readonly #onProgress?: (progress: PluginUpdateProgress) => void;
  #pending: PendingRelease | null = null;
  #operation: Promise<unknown> = Promise.resolve();

  constructor(input: {
    configuration: PluginReleaseConfiguration;
    paths: PluginReleasePaths;
    host: PluginReleaseRuntimeHost;
    fetch?: typeof fetch;
    onProgress?: (progress: PluginUpdateProgress) => void;
  }) {
    this.#configuration = input.configuration;
    this.#paths = input.paths;
    this.#host = input.host;
    this.#fetch = input.fetch ?? fetch;
    this.#onProgress = input.onProgress;
  }

  #progress(progress: PluginUpdateProgress): void {
    try {
      this.#onProgress?.(progress);
    } catch (error) {
      console.warn(`[plugins] update progress listener failed: ${String(error)}`);
    }
  }

  check(): Promise<PluginReleaseCheckResult> {
    return this.#serialize(() => this.#check());
  }

  install(releaseId: string): Promise<PluginReleaseInstallResult> {
    return this.#serialize(() => this.#install(releaseId));
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operation.then(operation, operation);
    this.#operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #latestRelease(): Promise<LatestPluginRelease> {
    return fetchLatestPluginRelease({
      configuration: this.#configuration,
      currentApplicationVersion: this.#host.currentApplicationVersion(),
      fetch: this.#fetch,
    });
  }

  async #check(): Promise<PluginReleaseCheckResult> {
    this.#pending = null;
    if (!validConfiguration(this.#configuration)) return { kind: "unconfigured" };
    const latest = await this.#latestRelease();
    const { manifest } = latest;

    const state = await readState(this.#paths.stateFile);
    if (
      state.activeReleaseId &&
      manifest.revokedReleaseIds.includes(state.activeReleaseId)
    ) {
      const active = [...state.history]
        .reverse()
        .find((entry) => entry.releaseId === state.activeReleaseId);
      if (!active) {
        throw new Error(
          `revoked plugin release "${state.activeReleaseId}" has no rollback snapshot`,
        );
      }
      const rollback = await this.#host.activate(
        rollbackProfile(active.profileBefore),
      );
      if (rollback.status !== "replaced") {
        throw new Error(`rollback of revoked plugin release "${active.releaseId}" was cancelled`);
      }
      const remainingHistory = state.history.filter(
        (entry) => entry.releaseId !== active.releaseId,
      );
      const previousRelease = remainingHistory.at(-1)?.releaseId;
      await writeJsonAtomic(this.#paths.stateFile, {
        schemaVersion: STATE_SCHEMA_VERSION,
        ...(previousRelease ? { activeReleaseId: previousRelease } : {}),
        history: remainingHistory,
      } satisfies PluginReleaseState);
      return {
        kind: "rolled-back",
        releaseId: active.releaseId,
        reason: "The publisher revoked this release. The previous plugin profile was restored automatically.",
      };
    }

    if (!latest.compatible) {
      return {
        kind: "incompatible",
        releaseId: manifest.releaseId,
        minApplicationVersion: manifest.application.minVersion,
        ...(manifest.application.maxVersionExclusive
          ? {
              maxApplicationVersionExclusive:
                manifest.application.maxVersionExclusive,
            }
          : {}),
      };
    }
    const snapshot = this.#host.snapshot();
    const need = releaseNeed(manifest, snapshot);
    const display = displayRelease(manifest, snapshot, need.needed, need.skipped);
    if (need.blockedReason) {
      return { kind: "blocked", release: display, reason: need.blockedReason };
    }
    if (need.needed.length === 0) {
      if (need.skipped.length > 0) {
        return {
          kind: "blocked",
          release: display,
          reason: "The available updates target customized plugins, which Termco will not overwrite.",
        };
      }
      return { kind: "up-to-date" };
    }
    this.#pending = {
      manifest,
      ...(latest.catalog ? { catalog: latest.catalog } : {}),
      baselineProfileId: snapshot.profile.id,
      display,
    };
    return { kind: "available", release: display };
  }

  async #install(releaseId: string): Promise<PluginReleaseInstallResult> {
    const pending = this.#pending;
    if (!pending || pending.manifest.releaseId !== releaseId) {
      throw new Error("plugin release must be checked and confirmed before installation");
    }
    const previous = this.#host.snapshot();
    if (previous.profile.id !== pending.baselineProfileId) {
      this.#pending = null;
      throw new Error("active plugin profile changed after the release check");
    }
    const need = releaseNeed(pending.manifest, previous);
    if (need.blockedReason || need.needed.length === 0) {
      this.#pending = null;
      throw new Error(need.blockedReason ?? "installed plugins changed after the release check");
    }

    const latest = await this.#latestRelease();
    if (
      latest.manifest.releaseId !== pending.manifest.releaseId ||
      canonicalJson(latest.manifest) !== canonicalJson(pending.manifest) ||
      (latest.catalog === undefined) !== (pending.catalog === undefined) ||
      (latest.catalog !== undefined && pending.catalog !== undefined &&
        canonicalJson(latest.catalog) !== canonicalJson(pending.catalog))
    ) {
      this.#pending = null;
      throw new Error(
        "plugin release feed changed after confirmation; check for updates again",
      );
    }

    await fs.mkdir(this.#paths.stagingRoot, { recursive: true });
    const staging = await fs.mkdtemp(join(this.#paths.stagingRoot, "release-"));
    const extracted = join(staging, "source");
    const stagedCache = join(staging, "cache");
    const finalReleaseRoot = join(
      this.#paths.officialPluginsRoot,
      pending.manifest.releaseId,
    );
    let sourceCommitted = false;
    try {
      const catalogItems = new Map(
        latest.catalog?.plugins.map((plugin) => [plugin.id, plugin]),
      );
      if (latest.catalog && latest.pluginAssets) {
        const totalBytes = need.needed.reduce((total, item) => {
          const catalogItem = catalogItems.get(item.id);
          if (!catalogItem) {
            throw new Error(`plugin catalog is missing "${item.id}"`);
          }
          return total + catalogItem.artifact.size;
        }, 0);
        let downloadedBytes = 0;
        this.#progress({
          stage: "downloading",
          completed: 0,
          total: totalBytes,
          downloadedBytes: 0,
          totalBytes,
        });
        for (const item of need.needed) {
          const catalogItem = catalogItems.get(item.id);
          const asset = latest.pluginAssets.get(item.id);
          if (!catalogItem || !asset) {
            throw new Error(`plugin artifact for "${item.id}" is unavailable`);
          }
          const response = await this.#fetch(asset.browser_download_url, {
            headers: authHeaders(this.#configuration),
          });
          const completedBefore = downloadedBytes;
          const bytes = await responseBytes(
            response,
            `plugin artifact download for "${item.id}"`,
            catalogItem.artifact.size,
            (received) => this.#progress({
              stage: "downloading",
              completed: completedBefore + received,
              total: totalBytes,
              downloadedBytes: completedBefore + received,
              totalBytes,
              pluginName: item.name,
            }),
          );
          downloadedBytes += bytes.byteLength;
          this.#progress({
            stage: "verifying",
            completed: downloadedBytes,
            total: totalBytes,
            pluginName: item.name,
          });
          assertArchiveIntegrity(bytes, catalogItem.artifact);
          await extractPluginReleaseArchive(bytes, extracted);
          this.#progress({
            stage: "verifying",
            completed: downloadedBytes,
            total: totalBytes,
            pluginName: item.name,
          });
        }
      } else {
        const response = await this.#fetch(latest.archiveAsset.browser_download_url, {
          headers: authHeaders(this.#configuration),
        });
        this.#progress({
          stage: "downloading",
          completed: 0,
          total: pending.manifest.archive.size,
          downloadedBytes: 0,
          totalBytes: pending.manifest.archive.size,
        });
        const bytes = await responseBytes(
          response,
          "plugin release archive download",
          pending.manifest.archive.size,
          (received) => this.#progress({
            stage: "downloading",
            completed: received,
            total: pending.manifest.archive.size,
            downloadedBytes: received,
            totalBytes: pending.manifest.archive.size,
          }),
        );
        this.#progress({ stage: "verifying", completed: 0, total: 1 });
        assertArchiveIntegrity(bytes, pending.manifest.archive);
        await extractPluginReleaseArchive(bytes, extracted);
        this.#progress({ stage: "verifying", completed: 1, total: 1 });
      }

      const expectedIds = new Set(
        (latest.catalog ? need.needed : pending.manifest.plugins).map(({ id }) => id),
      );
      const pluginRoot = join(extracted, "plugins");
      const archiveIds = (await fs.readdir(pluginRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => entry.name);
      if (
        archiveIds.length !== expectedIds.size ||
        archiveIds.some((id) => !expectedIds.has(id))
      ) {
        throw new Error("plugin release archive contents do not match the signed plugin set");
      }

      const neededIds = new Set(need.needed.map((item) => item.id));
      const compiled = new Map<string, { manifest: TermcoPluginManifestV3; integrity: string }>();
      for (const [index, item] of need.needed.entries()) {
        this.#progress({
          stage: "preparing",
          completed: index,
          total: need.needed.length,
          pluginName: item.name,
        });
        const sourceRoot = join(pluginRoot, item.id);
        const manifestFile = JSON.parse(
          await fs.readFile(join(sourceRoot, "termco-plugin.json"), "utf8"),
        ) as unknown;
        const parsed = parsePluginManifestV3(manifestFile);
        if (!parsed.ok) {
          throw new Error(`released plugin "${item.id}" has an invalid manifest: ${parsed.error}`);
        }
        if (parsed.manifest.id !== item.id || parsed.manifest.version !== item.version) {
          throw new Error(`released plugin "${item.id}" does not match its signed id and version`);
        }
        if (!parsed.manifest.entrypoints) {
          throw new Error(`released plugin "${item.id}" has no runtime entrypoint`);
        }
        const result = await this.#host.compile(sourceRoot, stagedCache);
        if (result.manifest.id !== item.id || result.manifest.version !== item.version) {
          throw new Error(`compiled plugin "${item.id}" changed identity during staging`);
        }
        compiled.set(item.id, result);
      }
      this.#progress({
        stage: "preparing",
        completed: need.needed.length,
        total: need.needed.length,
      });

      try {
        await fs.lstat(finalReleaseRoot);
        throw new Error(`plugin release source already exists at ${finalReleaseRoot}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await fs.mkdir(this.#paths.officialPluginsRoot, { recursive: true });
      await fs.rename(extracted, finalReleaseRoot);
      sourceCommitted = true;

      for (const item of need.needed) {
        const result = compiled.get(item.id) as {
          manifest: TermcoPluginManifestV3;
          integrity: string;
        };
        const stagedGeneration = join(stagedCache, item.id, item.version);
        const finalGeneration = join(this.#paths.cacheRoot, item.id, item.version);
      await installCompiledPluginGeneration(stagedGeneration, finalGeneration);
        const installedIntegrity = (
          await fs.readFile(join(finalGeneration, "integrity.txt"), "utf8")
        ).trim();
        if (installedIntegrity !== result.integrity) {
          throw new Error(`compiled plugin "${item.id}" failed the final integrity check`);
        }
      }

      const sourceById = new Map(
        need.needed.map((item) => [
          item.id,
          join(finalReleaseRoot, "plugins", item.id),
        ]),
      );
      const updatedIds = new Set(neededIds);
      const existingIds = new Set<string>();
      const plugins = previous.profile.plugins.map((row): ProfilePluginRowV3 => {
        const manifest = previous.manifests.get(row.id);
        const pluginId = manifest?.id ?? row.id;
        const source = sourceById.get(pluginId);
        if (!source) return { ...row };
        existingIds.add(pluginId);
        return { ...row, module: `official:${source}` };
      });
      for (const item of need.needed) {
        if (!existingIds.has(item.id)) {
          plugins.push({
            id: item.id,
            module: `official:${sourceById.get(item.id) as string}`,
          });
        }
      }
      const profile: TermcoProfileV3 = {
        schemaVersion: 3,
        id: `termco.release.${Date.now()}.${randomUUID().slice(0, 8)}`,
        bundles: [...previous.profile.bundles],
        plugins,
        patches: [...previous.profile.patches],
      };
      this.#progress({ stage: "activating", completed: 0, total: 1 });
      const activation = await this.#host.activate(profile);
      if (activation.status === "cancelled") {
        await fs.rm(finalReleaseRoot, { recursive: true, force: true });
        sourceCommitted = false;
        return { status: "cancelled", release: pending.display };
      }

      const state = await readState(this.#paths.stateFile);
      const installed: InstalledPluginRelease = {
        releaseId: pending.manifest.releaseId,
        installedAt: new Date().toISOString(),
        profileBefore: snapshotProfile(previous.profile),
        profileAfterId: profile.id,
        pluginIds: [...updatedIds],
      };
      try {
        await writeJsonAtomic(this.#paths.stateFile, {
          schemaVersion: STATE_SCHEMA_VERSION,
          activeReleaseId: installed.releaseId,
          history: [...state.history, installed],
        } satisfies PluginReleaseState);
      } catch (stateError) {
        const rollback = await this.#host.activate(
          rollbackProfile(installed.profileBefore),
        );
        if (rollback.status !== "replaced") {
          throw new AggregateError(
            [stateError, new Error("plugin release state rollback was cancelled")],
            "plugin release installed but durable state failed",
          );
        }
        throw stateError;
      }
      this.#pending = null;
      this.#progress({ stage: "activating", completed: 1, total: 1 });
      return { status: "installed", release: pending.display };
    } catch (error) {
      if (sourceCommitted) {
        try {
          await fs.rm(finalReleaseRoot, { recursive: true, force: true });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "plugin release failed and staged source cleanup failed",
          );
        }
      }
      throw error;
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}

export async function loadPluginReleaseConfiguration(
  file: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PluginReleaseConfiguration> {
  let stored: unknown = {};
  try {
    stored = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`cannot read plugin release configuration: ${String(error)}`);
    }
  }
  const value = stored && typeof stored === "object" && !Array.isArray(stored)
    ? stored as Record<string, unknown>
    : {};
  const publicKeys = value.publicKeys && typeof value.publicKeys === "object" && !Array.isArray(value.publicKeys)
    ? Object.fromEntries(
        Object.entries(value.publicKeys).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
  const environmentKey = environment.TERMCO_PLUGIN_RELEASE_PUBLIC_KEY;
  const environmentKeyId = environment.TERMCO_PLUGIN_RELEASE_KEY_ID ?? "environment";
  return {
    enabled:
      environment.TERMCO_PLUGIN_RELEASE_REPOSITORY !== undefined ||
      value.enabled === true,
    repository:
      environment.TERMCO_PLUGIN_RELEASE_REPOSITORY ??
      (typeof value.repository === "string" ? value.repository : ""),
    publicKeys: {
      ...publicKeys,
      ...(environmentKey ? { [environmentKeyId]: environmentKey } : {}),
    },
    ...(environment.TERMCO_PLUGIN_RELEASE_API_BASE_URL
      ? { apiBaseUrl: environment.TERMCO_PLUGIN_RELEASE_API_BASE_URL }
      : typeof value.apiBaseUrl === "string"
        ? { apiBaseUrl: value.apiBaseUrl }
        : {}),
    ...(environment.TERMCO_PLUGIN_RELEASE_TOKEN
      ? { token: environment.TERMCO_PLUGIN_RELEASE_TOKEN }
      : {}),
  };
}

export function officialPluginSourcePath(module: string): string | null {
  if (!module.startsWith("official:")) return null;
  const source = describePluginSource(module);
  return basename(source.location) ? source.location : null;
}

export interface BundledPluginBaselineReconciliation {
  profile: TermcoProfileV3;
  superseded: Array<{ pluginId: string; version: string }>;
}

/** A newly installed application is authoritative when its bundled generation
 * is equal to or newer than an independently installed official plugin. The
 * caller persists the returned derived profile before deleting the listed
 * disposable user-cache generations. */
export async function preferBundledPluginBaseline(input: {
  profile: TermcoProfileV3;
  repositoryRoot: string;
  createProfileId?: () => string;
}): Promise<BundledPluginBaselineReconciliation> {
  const superseded: Array<{ pluginId: string; version: string }> = [];
  const plugins: ProfilePluginRowV3[] = [];
  for (const row of input.profile.plugins) {
    const officialRoot = officialPluginSourcePath(row.module);
    if (!officialRoot) {
      plugins.push({ ...row });
      continue;
    }
    let official: ReturnType<typeof parsePluginManifestV3>;
    try {
      official = parsePluginManifestV3(
        JSON.parse(
          await fs.readFile(join(officialRoot, "termco-plugin.json"), "utf8"),
        ) as unknown,
      );
    } catch (error) {
      throw new Error(
        `cannot read official plugin source for "${row.id}": ${String(error)}`,
      );
    }
    if (!official.ok) {
      throw new Error(
        `official plugin source for "${row.id}" is invalid: ${official.error}`,
      );
    }
    const bundledRoot = join(
      input.repositoryRoot,
      "plugins",
      official.manifest.id,
    );
    let bundled: ReturnType<typeof parsePluginManifestV3>;
    try {
      bundled = parsePluginManifestV3(
        JSON.parse(
          await fs.readFile(join(bundledRoot, "termco-plugin.json"), "utf8"),
        ) as unknown,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        plugins.push({ ...row });
        continue;
      }
      throw error;
    }
    if (!bundled.ok) {
      throw new Error(
        `bundled plugin source for "${row.id}" is invalid: ${bundled.error}`,
      );
    }
    if (
      !/^\d+\.\d+\.\d+$/.test(official.manifest.version) ||
      !/^\d+\.\d+\.\d+$/.test(bundled.manifest.version) ||
      compareStableVersions(
        bundled.manifest.version,
        official.manifest.version,
      ) < 0
    ) {
      plugins.push({ ...row });
      continue;
    }
    superseded.push({
      pluginId: official.manifest.id,
      version: official.manifest.version,
    });
    plugins.push({
      ...row,
      module: `bundled:plugin-repository/plugins/${official.manifest.id}`,
    });
  }
  if (superseded.length === 0) {
    return { profile: snapshotProfile(input.profile), superseded };
  }
  return {
    profile: {
      ...snapshotProfile(input.profile),
      id:
        input.createProfileId?.() ??
        `termco.app-baseline.${Date.now()}.${randomUUID().slice(0, 8)}`,
      plugins,
    },
    superseded,
  };
}

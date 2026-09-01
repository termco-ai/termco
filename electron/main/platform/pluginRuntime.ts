import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
  type BootDiagnostic,
} from "../../../plugin-repository/plugins/application-base/src/index";
import { prepareProfileProcess, type PreparedProfileProcess } from "../../../src/platform/bootstrap";
import type {
  ProfilePluginRowV3,
  TermcoPluginManifestV3,
  TermcoProfileV3,
} from "../../../src/platform/contracts";
import { buildPluginCatalog } from "../../../src/platform/catalog";
import {
  locateCompiledPlugin,
  qualifyCompiledPluginGenerations,
  type PluginCacheRoots,
} from "../../../src/platform/moduleLoader";
import { projectPluginTree } from "../../../src/platform/processGraph";
import { CapabilityRpcRouter } from "../../../src/platform/remoteCapabilities";
import {
  serializeRendererBootstrap,
  type RendererBootstrapData,
} from "../../../src/platform/rendererBootstrap";
import {
  changedPluginIds,
  LiveGraphController,
  LiveReplacementError,
  type ReplacementResult,
  type ReplacementWarning,
} from "../../../src/platform/liveReplacement";
import {
  describePluginSource,
  loadProfileDirectories,
} from "../../../src/platform/sourceCatalog";
import { parsePluginManifestV3 } from "../../../src/platform/manifest";
import { parseProfileV3 } from "../../../src/platform/profile";
import { essentialPluginReasons } from "../../../src/platform/pluginDeactivationPolicy";
import { PluginEnablePreviewRegistry } from "../../../src/platform/profileTransactions";
import type {
  PluginCreateRequest,
  PluginCreateResult,
  PluginCreationTarget,
  PluginAuthoringPlanRequest,
  PluginAuthoringPlanResult,
  PluginDisableImpact,
  PluginEnableConfirmation,
  PluginForkRequest,
  PluginForkResult,
  PluginMutationResult,
  PluginOnboardingPlan,
  PluginUndoResult,
  ProfileExportRequest,
  ProfileExportResult,
  ProfileImportResult,
  ProfileManagementSnapshot,
} from "../../../plugin-repository/plugins/profile-base/src/profileApi";
import {
  CapabilityIpcHost,
  mergePluginRemovalImpacts,
  registerCapabilityIpc,
} from "./capabilityIpc";
import { compileLivePlugin } from "./livePluginCompiler";
import {
  loadPluginReleaseConfiguration,
  PluginReleaseManager,
  preferBundledPluginBaseline,
} from "./pluginReleaseManager";
import {
  installInitialPluginRelease,
  pluginBootstrapStatus,
} from "./pluginBootstrap";
import type {
  PluginBootstrapProgress,
  PluginBootstrapResult,
  PluginBootstrapStatus,
} from "../../../src/platform/pluginBootstrap";
import { scaffoldPlugin } from "./pluginTemplates";
import { UI_CONTRIBUTION_AUTHORING_DESCRIPTORS } from "../../../plugin-repository/plugins/ui-shell-base/src/generated/authoringCatalog";
import {
  createProfilePackage,
  parseProfilePackage,
  PROFILE_DEFAULT_KEYS,
  validateProfileDefaults,
  writeParsedProfilePackage,
} from "./profilePackage";
import { broadcastEvent } from "../windows";

let active: PreparedProfileProcess | null = null;
let ipcHost: CapabilityIpcHost | null = null;
let liveController: LiveGraphController | null = null;
let pluginReleaseManager: PluginReleaseManager | null = null;
let pluginReleaseSender: WebContents | null = null;
let replacementTransaction = Promise.resolve();
const enabledPreviews = new PluginEnablePreviewRegistry();
type PluginCompletionTransaction = {
  completionId: string;
  pluginId: string;
  generation: string;
  appliedProfileId: string;
  previousProfile: TermcoProfileV3;
};
const pluginCompletions = new Map<string, PluginCompletionTransaction>();
const pluginAuthoringPlans = new Map<string, {
  plan: PluginAuthoringPlanResult;
  used: boolean;
}>();
const GENERATED_USER_PROFILE_ID = /^termco\.user\.\d+\.[a-f0-9]{8}$/;

/** Capture only the strict persisted profile contract. Runtime composition
 * metadata such as provenance and layers must never enter an Undo transaction. */
export function snapshotProfile(
  profile: TermcoProfileV3,
): TermcoProfileV3 {
  return structuredClone({
    schemaVersion: profile.schemaVersion,
    id: profile.id,
    bundles: profile.bundles,
    plugins: profile.plugins,
    patches: profile.patches,
  });
}

export function mergeGeneratedUserProfileDefaults(
  profile: TermcoProfileV3,
  defaults: TermcoProfileV3,
): { profile: TermcoProfileV3; addedPluginIds: string[] } {
  const selected = new Map(profile.plugins.map((row) => [row.id, row]));
  const defaultIds = new Set(defaults.plugins.map((row) => row.id));
  const addedPluginIds = defaults.plugins
    .filter((row) => !selected.has(row.id))
    .map((row) => row.id);
  if (addedPluginIds.length === 0) return { profile, addedPluginIds };
  return {
    profile: {
      ...profile,
      plugins: [
        ...defaults.plugins.map((row) => ({ ...(selected.get(row.id) ?? row) })),
        ...profile.plugins
          .filter((row) => !defaultIds.has(row.id))
          .map((row) => ({ ...row })),
      ],
    },
    addedPluginIds,
  };
}

export function repairOrphanedReplacementRows(
  profile: TermcoProfileV3,
  previous: TermcoProfileV3 | undefined,
  managedPluginsRoot: string,
): { profile: TermcoProfileV3; restoredPluginIds: string[] } {
  if (!previous) return { profile, restoredPluginIds: [] };
  const currentIds = new Set(profile.plugins.map((row) => row.id));
  const restoredPluginIds: string[] = [];
  const plugins = profile.plugins.map((row) => {
    if (row.enabled !== false || row.disabledBy) return { ...row };
    const previousIndex = previous.plugins.findIndex((candidate) =>
      candidate.id === row.id && candidate.enabled === false
    );
    const removedNeighbor = previous.plugins[previousIndex + 1];
    if (
      previousIndex < 0 ||
      !removedNeighbor ||
      currentIds.has(removedNeighbor.id) ||
      !isAbsolute(removedNeighbor.module)
    ) {
      return { ...row };
    }
    const managedRelative = relative(managedPluginsRoot, removedNeighbor.module);
    if (
      managedRelative !== removedNeighbor.id ||
      managedRelative.startsWith("..") ||
      isAbsolute(managedRelative)
    ) {
      return { ...row };
    }
    restoredPluginIds.push(row.id);
    const { enabled: _disabled, ...restored } = row;
    return restored;
  });
  return {
    profile: restoredPluginIds.length > 0 ? { ...profile, plugins } : profile,
    restoredPluginIds,
  };
}

function isDirectManagedPluginRow(
  row: ProfilePluginRowV3,
  managedPluginsRoot: string,
): boolean {
  if (!isAbsolute(row.module)) return false;
  const managedRelative = relative(managedPluginsRoot, row.module);
  return managedRelative === row.id &&
    !managedRelative.startsWith("..") &&
    !isAbsolute(managedRelative);
}

export function removeMissingManagedPluginRows(
  profile: TermcoProfileV3,
  managedPluginsRoot: string,
  missingSourceModules: ReadonlySet<string>,
): {
  profile: TermcoProfileV3;
  removedPluginIds: string[];
  restoredPluginIds: string[];
} {
  const removedRows = profile.plugins.filter((row) =>
    isDirectManagedPluginRow(row, managedPluginsRoot) &&
    missingSourceModules.has(row.module)
  );
  if (removedRows.length === 0) {
    return { profile, removedPluginIds: [], restoredPluginIds: [] };
  }
  const removedIds = new Set(removedRows.map((row) => row.id));
  const restoredPluginIds: string[] = [];
  const plugins = profile.plugins.flatMap((row): ProfilePluginRowV3[] => {
    if (removedIds.has(row.id)) return [];
    if (row.enabled === false && row.disabledBy && removedIds.has(row.disabledBy)) {
      const {
        enabled: _disabled,
        disabledBy: _replacementOwner,
        ...restored
      } = row;
      restoredPluginIds.push(row.id);
      return [restored];
    }
    return [{ ...row }];
  });
  return {
    profile: { ...profile, plugins },
    removedPluginIds: removedRows.map((row) => row.id),
    restoredPluginIds,
  };
}

async function missingManagedPluginModules(
  profile: TermcoProfileV3,
  managedPluginsRoot: string,
): Promise<Set<string>> {
  const missing = new Set<string>();
  for (const row of profile.plugins) {
    if (!isDirectManagedPluginRow(row, managedPluginsRoot)) continue;
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(row.module);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing.add(row.module);
        continue;
      }
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(
        `managed plugin source "${row.module}" is not a real directory`,
      );
    }
  }
  return missing;
}

class RendererConvergenceError extends AggregateError {
  constructor(errors: readonly unknown[], summary: string) {
    super(
      errors,
      `${summary}: ${errors
        .map((error) =>
          error instanceof Error ? error.message : String(error),
        )
        .join("; ")}`,
    );
    this.name = "RendererConvergenceError";
  }
}

export function serializeReplacementTransaction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = replacementTransaction.then(operation, operation);
  replacementTransaction = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function runForwardReplacement<T>(input: {
  replaceMain(beforeDeactivate: () => Promise<void>): Promise<T>;
  quiesceRenderer(): Promise<void>;
  restorePreviousRenderer(): Promise<void>;
}): Promise<T> {
  let quiesceAttempted = false;
  try {
    return await input.replaceMain(async () => {
      quiesceAttempted = true;
      await input.quiesceRenderer();
    });
  } catch (error) {
    if (quiesceAttempted) {
      try {
        await input.restorePreviousRenderer();
      } catch (convergenceError) {
        throw new RendererConvergenceError(
          [error, convergenceError],
          "main replacement failed and previous renderer convergence failed",
        );
      }
    }
    throw error;
  }
}

export async function runBackwardReplacement(input: {
  quiesceCandidateRenderer(): Promise<void>;
  restoreCandidateRenderer(): Promise<void>;
  restoreMain(): Promise<void>;
  installPreviousRouter(): void;
  activatePreviousRenderer(): Promise<void>;
}): Promise<void> {
  try {
    await input.quiesceCandidateRenderer();
  } catch (quiesceError) {
    try {
      await input.restoreCandidateRenderer();
    } catch (convergenceError) {
      throw new RendererConvergenceError(
        [quiesceError, convergenceError],
        "renderer rollback quiescence failed and candidate convergence failed",
      );
    }
    throw quiesceError;
  }
  try {
    await input.restoreMain();
  } catch (mainRollbackError) {
    try {
      await input.restoreCandidateRenderer();
    } catch (convergenceError) {
      throw new RendererConvergenceError(
        [mainRollbackError, convergenceError],
        "main rollback failed and candidate renderer convergence failed",
      );
    }
    throw mainRollbackError;
  }
  input.installPreviousRouter();
  await input.activatePreviousRenderer();
}

export function replacementPluginScopes(
  runtime: Pick<
    PreparedProfileProcess["runtime"],
    "dependencyClosedPluginIds" | "serviceProviders"
  >,
  externallyChangedPluginIds: ReadonlySet<string>,
): {
  rendererChangedPluginIds: string[];
  rendererChangedServiceNames: string[];
  drainProviderPluginIds: string[];
} {
  const mainAffectedPluginIds = [
    ...runtime.dependencyClosedPluginIds(externallyChangedPluginIds),
  ];
  const mainAffected = new Set(mainAffectedPluginIds);
  const rendererChangedServiceNames = [
    ...new Set(
      runtime
        .serviceProviders()
        .filter((provider) => mainAffected.has(provider.providerId))
        .map((provider) => provider.name),
    ),
  ];
  return {
    rendererChangedPluginIds: [...externallyChangedPluginIds],
    rendererChangedServiceNames,
    drainProviderPluginIds: [...mainAffectedPluginIds],
  };
}

const PLUGIN_HOST = "__plugins";
const CREATE_PLUGIN_CHANNEL = "termco:plugins:create";
const PLAN_PLUGIN_CHANNEL = "termco:plugins:plan";
const FORK_PLUGIN_CHANNEL = "termco:plugins:fork";
const COPY_REPLACE_CHANNEL = "termco:plugins:copy-and-replace";
const APPLY_PLUGIN_CHANNEL = "termco:plugins:apply";
const UNDO_PLUGIN_CHANNEL = "termco:plugins:undo";
const UNINSTALL_PLUGIN_CHANNEL = "termco:plugins:uninstall";
const SET_PLUGIN_ENABLED_CHANNEL = "termco:plugins:set-enabled";
const PREVIEW_SET_PLUGIN_ENABLED_CHANNEL =
  "termco:plugins:preview-set-enabled";
const INSTALL_PLUGIN_FROM_FOLDER_CHANNEL = "termco:plugins:install-from-folder";
const OPEN_PLUGINS_FOLDER_CHANNEL = "termco:plugins:open-folder";
const OPEN_PLUGIN_FOLDER_CHANNEL = "termco:plugins:open-plugin-folder";
const ACTIVATE_PROFILE_CHANNEL = "termco:plugins:activate-profile";
const PROFILE_SNAPSHOT_CHANNEL = "termco:profiles:snapshot";
const EXPORT_PROFILE_CHANNEL = "termco:profiles:export";
const IMPORT_PROFILE_CHANNEL = "termco:profiles:import";
const RECOVER_RENDERER_PROFILE_CHANNEL = "termco:plugins:recover-renderer";
const LIST_PLUGIN_DRAFTS_CHANNEL = "termco:plugins:list-drafts";
const LIST_SOURCE_FILES_CHANNEL = "termco:plugins:list-source-files";
const READ_SOURCE_FILE_CHANNEL = "termco:plugins:read-source-file";
const WRITE_SOURCE_FILE_CHANNEL = "termco:plugins:write-source-file";
const CHECK_PLUGIN_RELEASES_CHANNEL = "termco:plugins:releases:check";
const INSTALL_PLUGIN_RELEASE_CHANNEL = "termco:plugins:releases:install";
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const SAFE_PROFILE_ID = "termco.safe-recovery";
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export async function recordProfileBootFailure(
  runtime: Pick<PreparedProfileProcess["runtime"], "callCapability">,
  requestedProfileId: string,
  error: unknown,
  at = new Date().toISOString(),
): Promise<void> {
  const diagnostic: BootDiagnostic = {
    requestedProfileId,
    recoveryProfileId: SAFE_PROFILE_ID,
    phase: "profile-boot",
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    at,
  };
  await runtime.callCapability(
    APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
    "record",
    [diagnostic],
  );
}

export interface CopyAndReplacePluginRequest {
  pluginId: string;
  replacementId: string;
  name?: string;
}

export type CopyAndReplacePluginResult = PluginMutationResult;
export type ApplyPluginResult = PluginMutationResult;

export interface UninstallPluginResult {
  status: "uninstalled" | "cancelled";
  pluginId: string;
  sourceFolder: string;
  movedToTrash: boolean;
  warning?: { message: string };
}

interface PluginPaths {
  repositoryRoot: string;
  bundledProfilesRoot: string;
  profileTemplatesRoot: string;
  userProfilesRoot: string;
  bundledCacheRoot: string;
  userCacheRoot: string;
  userPluginsRoot: string;
  profileStagingRoot: string;
  activeProfileFile: string;
  bootstrapCompletionFile: string;
  completionTransactionsFile: string;
  pluginReleaseStagingRoot: string;
  officialPluginsRoot: string;
  pluginReleaseStateFile: string;
  pluginReleaseConfigurationFile: string;
}

function roots(): PluginPaths {
  const userRoot = join(app.getPath("userData"), "plugin-platform");
  if (app.isPackaged) {
    const repositoryRoot = join(process.resourcesPath, "plugin-platform");
    return {
      repositoryRoot,
      bundledProfilesRoot: join(repositoryRoot, "profiles"),
      profileTemplatesRoot: join(repositoryRoot, "profile-templates"),
      userProfilesRoot: join(userRoot, "profiles"),
      bundledCacheRoot: join(repositoryRoot, "cache"),
      userCacheRoot: join(userRoot, "cache"),
      userPluginsRoot: join(userRoot, "plugins"),
      profileStagingRoot: join(userRoot, "staging"),
      activeProfileFile: join(userRoot, "active-profile.json"),
      bootstrapCompletionFile: join(userRoot, "initial-setup.json"),
      completionTransactionsFile: join(userRoot, "plugin-completions.json"),
      pluginReleaseStagingRoot: join(userRoot, "release-staging"),
      officialPluginsRoot: join(userRoot, "official-plugins"),
      pluginReleaseStateFile: join(userRoot, "plugin-releases.json"),
      pluginReleaseConfigurationFile: join(repositoryRoot, "plugin-release.json"),
    };
  }
  // Playwright launches the built main file directly, in which case
  // app.getAppPath() is dist-electron/main rather than the repository root.
  // Source profiles/caches still live at the launch cwd in development.
  const repositoryRoot = [app.getAppPath(), process.cwd()].find((candidate) =>
    existsSync(join(candidate, "profiles")),
  );
  if (!repositoryRoot) {
    throw new Error(
      `plugin development repository root not found from ${app.getAppPath()} or ${process.cwd()}`,
    );
  }
  return {
    repositoryRoot,
    bundledProfilesRoot: join(repositoryRoot, "profiles"),
    profileTemplatesRoot: join(repositoryRoot, "profiles"),
    userProfilesRoot: join(userRoot, "profiles"),
    bundledCacheRoot: join(repositoryRoot, ".termco-cache", "plugins"),
    userCacheRoot: join(userRoot, "cache"),
    userPluginsRoot: join(userRoot, "plugins"),
    profileStagingRoot: join(userRoot, "staging"),
    activeProfileFile: join(userRoot, "active-profile.json"),
    bootstrapCompletionFile: join(userRoot, "initial-setup.json"),
    completionTransactionsFile: join(userRoot, "plugin-completions.json"),
    pluginReleaseStagingRoot: join(userRoot, "release-staging"),
    officialPluginsRoot: join(userRoot, "official-plugins"),
    pluginReleaseStateFile: join(userRoot, "plugin-releases.json"),
    pluginReleaseConfigurationFile: join(repositoryRoot, "plugin-release.json"),
  };
}

export async function initialPluginBootstrapStatus(): Promise<PluginBootstrapStatus> {
  if (!app.isPackaged && process.env.TERMCO_FORCE_PLUGIN_BOOTSTRAP !== "1") {
    return { kind: "ready" };
  }
  const paths = roots();
  const configuration = await loadPluginReleaseConfiguration(
    paths.pluginReleaseConfigurationFile,
  );
  return pluginBootstrapStatus({
    applicationVersion: app.getVersion(),
    repository: configuration.repository,
    paths: {
      repositoryRoot: paths.repositoryRoot,
      profileTemplatesRoot: paths.profileTemplatesRoot,
      userProfilesRoot: paths.userProfilesRoot,
      activeProfileFile: paths.activeProfileFile,
      completionFile: paths.bootstrapCompletionFile,
      stagingRoot: paths.pluginReleaseStagingRoot,
      officialPluginsRoot: paths.officialPluginsRoot,
      cacheRoot: paths.userCacheRoot,
      stateFile: paths.pluginReleaseStateFile,
      configurationFile: paths.pluginReleaseConfigurationFile,
    },
  });
}

let initialBootstrapOperation: Promise<PluginBootstrapResult> | null = null;

export function installInitialPluginBootstrap(
  onProgress: (progress: PluginBootstrapProgress) => void,
): Promise<PluginBootstrapResult> {
  if (initialBootstrapOperation) return initialBootstrapOperation;
  const paths = roots();
  const operation = installInitialPluginRelease({
    applicationVersion: app.getVersion(),
    paths: {
      repositoryRoot: paths.repositoryRoot,
      profileTemplatesRoot: paths.profileTemplatesRoot,
      userProfilesRoot: paths.userProfilesRoot,
    activeProfileFile: paths.activeProfileFile,
    completionFile: paths.bootstrapCompletionFile,
      stagingRoot: paths.pluginReleaseStagingRoot,
      officialPluginsRoot: paths.officialPluginsRoot,
      cacheRoot: paths.userCacheRoot,
      stateFile: paths.pluginReleaseStateFile,
      configurationFile: paths.pluginReleaseConfigurationFile,
    },
    compile: (pluginRoot, cacheRoot) =>
      compileLivePlugin({
        repositoryRoot: paths.repositoryRoot,
        pluginRoot,
        cacheRoot,
      }),
    onProgress,
  });
  initialBootstrapOperation = operation.finally(() => {
    initialBootstrapOperation = null;
  });
  return initialBootstrapOperation;
}

async function createPluginReleaseManager(
  paths: PluginPaths,
): Promise<PluginReleaseManager> {
  const configuration = await loadPluginReleaseConfiguration(
    paths.pluginReleaseConfigurationFile,
  );
  return new PluginReleaseManager({
    configuration,
    paths: {
      stagingRoot: paths.pluginReleaseStagingRoot,
      officialPluginsRoot: paths.officialPluginsRoot,
      cacheRoot: paths.userCacheRoot,
      stateFile: paths.pluginReleaseStateFile,
    },
    host: {
      currentApplicationVersion: () => app.getVersion(),
      snapshot() {
        if (!active) throw new Error("plugin runtime is not active");
        return {
          profile: snapshotProfile(active.profile),
          manifests: active.manifests,
        };
      },
      compile: (pluginRoot, cacheRoot) =>
        compileLivePlugin({
          repositoryRoot: paths.repositoryRoot,
          pluginRoot,
          cacheRoot,
        }),
      async activate(profile) {
        const sender = pluginReleaseSender;
        const previous = active;
        if (!sender || sender.isDestroyed()) {
          throw new Error("plugin release window is no longer available");
        }
        if (!previous) throw new Error("plugin runtime is not active");
        return activateProfileLayer({ sender, paths, previous, profile });
      },
    },
    onProgress: (progress) =>
      broadcastEvent("updater://plugin-progress", progress),
  });
}

async function loadPluginCompletions(paths: PluginPaths): Promise<void> {
  pluginCompletions.clear();
  try {
    const parsed = JSON.parse(
      await fs.readFile(paths.completionTransactionsFile, "utf8"),
    ) as unknown;
    if (!Array.isArray(parsed)) throw new Error("completion store must be an array");
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Partial<PluginCompletionTransaction>;
      const previousProfile = parseProfileV3(candidate.previousProfile);
      if (
        typeof candidate.completionId !== "string" ||
        typeof candidate.pluginId !== "string" ||
        typeof candidate.generation !== "string" ||
        typeof candidate.appliedProfileId !== "string" ||
        !previousProfile.ok
      ) continue;
      pluginCompletions.set(candidate.completionId, {
        completionId: candidate.completionId,
        pluginId: candidate.pluginId,
        generation: candidate.generation,
        appliedProfileId: candidate.appliedProfileId,
        previousProfile: previousProfile.profile,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[plugins] ignoring invalid completion transaction store: ${String(error)}`);
    }
  }
}

async function persistPluginCompletions(paths: PluginPaths): Promise<void> {
  await fs.mkdir(dirname(paths.completionTransactionsFile), { recursive: true });
  await writeJson(
    paths.completionTransactionsFile,
    [...pluginCompletions.values()],
  );
}

function profileRoots(paths: PluginPaths): readonly string[] {
  return [paths.bundledProfilesRoot, paths.userProfilesRoot];
}

function cacheRoots(paths: PluginPaths): readonly string[] {
  return [paths.userCacheRoot, paths.bundledCacheRoot];
}

async function selectedProfileId(paths: PluginPaths): Promise<string> {
  if (process.env.TERMCO_PROFILE) return process.env.TERMCO_PROFILE;
  try {
    const stored = JSON.parse(await fs.readFile(paths.activeProfileFile, "utf8")) as {
      profileId?: unknown;
    };
    if (typeof stored.profileId === "string") return stored.profileId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && error instanceof SyntaxError) {
      console.warn(`[plugins] ignoring invalid active profile state: ${error.message}`);
    }
  }
  return "termco.default";
}

async function reconcileGeneratedUserProfile(
  paths: PluginPaths,
  profileId: string,
): Promise<void> {
  if (!GENERATED_USER_PROFILE_ID.test(profileId)) return;
  const profiles = await loadProfileDirectories(profileRoots(paths));
  const profile = profiles.get(profileId);
  const defaults = profiles.get("termco.default");
  if (!profile || !defaults) return;
  const profileTimestamp = Number(profileId.split(".")[2]);
  const previous = [...profiles.entries()]
    .filter(([candidateId]) => GENERATED_USER_PROFILE_ID.test(candidateId))
    .map(([candidateId, candidate]) => ({
      timestamp: Number(candidateId.split(".")[2]),
      profile: candidate,
    }))
    .filter((candidate) => candidate.timestamp < profileTimestamp)
    .sort((left, right) => right.timestamp - left.timestamp)[0]?.profile;
  const missingModules = await missingManagedPluginModules(
    profile,
    paths.userPluginsRoot,
  );
  const missingRepair = removeMissingManagedPluginRows(
    profile,
    paths.userPluginsRoot,
    missingModules,
  );
  const repaired = repairOrphanedReplacementRows(
    missingRepair.profile,
    previous,
    paths.userPluginsRoot,
  );
  const reconciled = mergeGeneratedUserProfileDefaults(repaired.profile, defaults);
  if (
    reconciled.addedPluginIds.length === 0 &&
    repaired.restoredPluginIds.length === 0 &&
    missingRepair.removedPluginIds.length === 0 &&
    missingRepair.restoredPluginIds.length === 0
  ) return;
  await writeJson(
    join(paths.userProfilesRoot, profileId, "profile.json"),
    reconciled.profile,
  );
  console.log(
    `[plugins] reconciled ${profileId}` +
      (reconciled.addedPluginIds.length > 0
        ? ` with newly shipped plugins: ${reconciled.addedPluginIds.join(", ")}`
        : "") +
      (repaired.restoredPluginIds.length > 0
        ? `; restored orphaned replacement rows: ${repaired.restoredPluginIds.join(", ")}`
        : "") +
      (missingRepair.removedPluginIds.length > 0
        ? `; removed missing managed plugins: ${missingRepair.removedPluginIds.join(", ")}`
        : "") +
      (missingRepair.restoredPluginIds.length > 0
        ? `; restored plugins disabled by missing replacements: ${missingRepair.restoredPluginIds.join(", ")}`
        : ""),
  );
}

async function reconcileBundledApplicationPluginBaseline(
  paths: PluginPaths,
  profileId: string,
): Promise<string> {
  const profiles = await loadProfileDirectories(profileRoots(paths));
  const profile = profiles.get(profileId);
  if (!profile) return profileId;
  const reconciliation = await preferBundledPluginBaseline({
    profile,
    repositoryRoot: paths.repositoryRoot,
  });
  if (reconciliation.superseded.length === 0) return profileId;
  await writeJson(
    join(
      paths.userProfilesRoot,
      reconciliation.profile.id,
      "profile.json",
    ),
    reconciliation.profile,
  );
  await writeJson(paths.activeProfileFile, {
    profileId: reconciliation.profile.id,
  });
  for (const plugin of reconciliation.superseded) {
    await fs.rm(join(paths.userCacheRoot, plugin.pluginId, plugin.version), {
      recursive: true,
      force: true,
    });
  }
  console.log(
    `[plugins] application bundle superseded plugin release generations: ${reconciliation.superseded
      .map(({ pluginId, version }) => `${pluginId}@${version}`)
      .join(", ")}`,
  );
  return reconciliation.profile.id;
}

async function reconcileActiveMissingManagedPlugins(
  sender: WebContents,
): Promise<{ removedPluginIds: string[]; restoredPluginIds: string[] }> {
  const previous = active;
  if (!previous || !GENERATED_USER_PROFILE_ID.test(previous.profile.id)) {
    return { removedPluginIds: [], restoredPluginIds: [] };
  }
  const paths = roots();
  const strict = snapshotProfile(previous.profile);
  const missing = await missingManagedPluginModules(strict, paths.userPluginsRoot);
  const repaired = removeMissingManagedPluginRows(
    strict,
    paths.userPluginsRoot,
    missing,
  );
  if (repaired.removedPluginIds.length === 0) return repaired;
  const profile = {
    ...repaired.profile,
    id: `termco.user.${Date.now()}.${randomUUID().slice(0, 8)}`,
  };
  const result = await activateProfileLayer({ sender, paths, previous, profile });
  if (result.status === "cancelled") {
    throw new Error("removing missing managed plugin rows was cancelled");
  }
  console.log(
    `[plugins] removed missing managed plugins from the live profile: ${
      repaired.removedPluginIds.join(", ")
    }${
      repaired.restoredPluginIds.length > 0
        ? `; restored: ${repaired.restoredPluginIds.join(", ")}`
        : ""
    }`,
  );
  return repaired;
}

async function prepareSelectedProfile(
  paths: PluginPaths,
  profileId: string,
): Promise<PreparedProfileProcess> {
  return prepareProfileProcess({
    repositoryRoot: paths.repositoryRoot,
    profilesRoot: profileRoots(paths),
    cacheRoot: cacheRoots(paths),
    activeProfileId: profileId,
    process: "main",
  });
}

export async function bootPluginRuntime(): Promise<PreparedProfileProcess> {
  if (active) return active;
  const paths = roots();
  await loadPluginCompletions(paths);
  let requestedProfileId = await selectedProfileId(paths);
  await reconcileGeneratedUserProfile(paths, requestedProfileId);
  requestedProfileId = await reconcileBundledApplicationPluginBaseline(
    paths,
    requestedProfileId,
  );
  let activeProfileId = requestedProfileId;
  let prepared: PreparedProfileProcess;
  try {
    prepared = await prepareSelectedProfile(paths, requestedProfileId);
    await prepared.activate();
    prepared.runtime.assertSettled();
  } catch (startupError) {
    if (requestedProfileId === SAFE_PROFILE_ID) throw startupError;
    activeProfileId = SAFE_PROFILE_ID;
    try {
      prepared = await prepareSelectedProfile(paths, SAFE_PROFILE_ID);
      await prepared.activate();
      prepared.runtime.assertSettled();
      await recordProfileBootFailure(
        prepared.runtime,
        requestedProfileId,
        startupError,
      );
    } catch (recoveryError) {
      throw new AggregateError(
        [startupError, recoveryError],
        `profile "${requestedProfileId}" failed and recovery profile "${SAFE_PROFILE_ID}" could not start`,
      );
    }
    const message = startupError instanceof Error
      ? `${startupError.name}: ${startupError.message}`
      : String(startupError);
    console.error(
      `[plugins] profile ${requestedProfileId} failed; activated ${SAFE_PROFILE_ID}: ${message}`,
    );
  }
  const rendererProfile = await createRendererBootstrap(prepared, cacheRoots(paths));
  ipcHost = registerCapabilityIpc(
    new CapabilityRpcRouter(prepared.tree, prepared.runtime),
    rendererProfile,
  );
  liveController = new LiveGraphController(prepared.runtime);
  ipcMain.handle(CREATE_PLUGIN_CHANNEL, (event, request: unknown) =>
    serializeReplacementTransaction(() =>
      createPlugin(event.sender, request),
    ),
  );
  ipcMain.handle(PLAN_PLUGIN_CHANNEL, (_event, request: unknown) =>
    planPlugin(request),
  );
  ipcMain.handle(FORK_PLUGIN_CHANNEL, (event, request: unknown) =>
    serializeReplacementTransaction(() =>
      forkPlugin(event.sender, request),
    ),
  );
  ipcMain.handle(COPY_REPLACE_CHANNEL, (event, request: unknown) =>
    serializeReplacementTransaction(() =>
      copyAndReplacePlugin(event.sender, request),
    ),
  );
  ipcMain.handle(APPLY_PLUGIN_CHANNEL, (event, pluginId: unknown) =>
    serializeReplacementTransaction(() => applyPlugin(event.sender, pluginId)),
  );
  ipcMain.handle(UNDO_PLUGIN_CHANNEL, (event, completionId: unknown) =>
    serializeReplacementTransaction(() =>
      undoPluginCompletion(event.sender, completionId),
    ),
  );
  ipcMain.handle(UNINSTALL_PLUGIN_CHANNEL, (event, pluginId: unknown) =>
    serializeReplacementTransaction(() =>
      uninstallPlugin(event.sender, pluginId),
    ),
  );
  ipcMain.handle(SET_PLUGIN_ENABLED_CHANNEL, (event, request: unknown) =>
    serializeReplacementTransaction(() =>
      setPluginEnabled(event.sender, request),
    ),
  );
  ipcMain.handle(
    PREVIEW_SET_PLUGIN_ENABLED_CHANNEL,
    (event, request: unknown) =>
      serializeReplacementTransaction(() =>
        previewSetPluginEnabled(event.sender, request)
      ),
  );
  ipcMain.handle(INSTALL_PLUGIN_FROM_FOLDER_CHANNEL, (event) =>
    serializeReplacementTransaction(() => installPluginFromFolder(event.sender)),
  );
  ipcMain.handle(OPEN_PLUGINS_FOLDER_CHANNEL, () => openPluginsFolder());
  ipcMain.handle(OPEN_PLUGIN_FOLDER_CHANNEL, (event, pluginId: unknown) =>
    serializeReplacementTransaction(() =>
      openPluginFolder(event.sender, pluginId)
    ),
  );
  ipcMain.handle(ACTIVATE_PROFILE_CHANNEL, (event, profileId: unknown) =>
    serializeReplacementTransaction(() =>
      activateNamedProfile(event.sender, profileId),
    ),
  );
  ipcMain.handle(PROFILE_SNAPSHOT_CHANNEL, () => profileManagementSnapshot());
  ipcMain.handle(EXPORT_PROFILE_CHANNEL, (event, request: unknown) =>
    exportActiveProfile(event.sender, request),
  );
  ipcMain.handle(IMPORT_PROFILE_CHANNEL, (event) =>
    serializeReplacementTransaction(() => importProfilePackage(event.sender)),
  );
  ipcMain.handle(RECOVER_RENDERER_PROFILE_CHANNEL, (event, request: unknown) =>
    serializeReplacementTransaction(() =>
      recoverRendererProfile(event.sender, request),
    ),
  );
  ipcMain.handle(LIST_PLUGIN_DRAFTS_CHANNEL, () => listPluginDrafts());
  ipcMain.handle(LIST_SOURCE_FILES_CHANNEL, (_event, pluginId: unknown) =>
    listPluginSourceFiles(pluginId),
  );
  ipcMain.handle(READ_SOURCE_FILE_CHANNEL, (_event, request: unknown) =>
    readPluginSourceFile(request),
  );
  ipcMain.handle(WRITE_SOURCE_FILE_CHANNEL, (_event, request: unknown) =>
    writePluginSourceFile(request),
  );
  active = prepared;
  pluginReleaseManager = await createPluginReleaseManager(paths);
  ipcMain.handle(CHECK_PLUGIN_RELEASES_CHANNEL, (event) =>
    serializeReplacementTransaction(async () => {
      pluginReleaseSender = event.sender;
      try {
        return await pluginReleaseManager?.check();
      } finally {
        pluginReleaseSender = null;
      }
    }),
  );
  ipcMain.handle(INSTALL_PLUGIN_RELEASE_CHANNEL, (event, releaseId: unknown) =>
    serializeReplacementTransaction(async () => {
      if (typeof releaseId !== "string") {
        throw new Error("plugin release id is invalid");
      }
      pluginReleaseSender = event.sender;
      try {
        if (!pluginReleaseManager) {
          throw new Error("plugin release manager is not active");
        }
        return await pluginReleaseManager.install(releaseId);
      } finally {
        pluginReleaseSender = null;
      }
    }),
  );
  let removedStaleCompletion = false;
  for (const [completionId, completion] of pluginCompletions) {
    if (completion.appliedProfileId === prepared.profile.id) continue;
    pluginCompletions.delete(completionId);
    removedStaleCompletion = true;
  }
  if (removedStaleCompletion) await persistPluginCompletions(paths);
  console.log(
    `[plugins] profile ${activeProfileId} active (${prepared.processTree.activationOrder.join(", ")})`,
  );
  return prepared;
}

async function createRendererBootstrap(
  prepared: PreparedProfileProcess,
  cacheRoot: PluginCacheRoots,
): Promise<RendererBootstrapData> {
  const pendingMainPluginIds = new Set(
    prepared.runtime
      .inspect()
      .filter((fiber) => fiber.state === "pending")
      .map((fiber) => fiber.pluginId),
  );
  const rendererEligibleTree = {
    ...prepared.tree,
    plugins: prepared.tree.plugins.filter(
      (plugin) =>
        !(
          pendingMainPluginIds.has(plugin.id) &&
          plugin.manifest.entrypoints?.main &&
          plugin.manifest.entrypoints?.renderer
        ),
    ),
    activationOrder: prepared.tree.activationOrder.filter(
      (pluginId) => !pendingMainPluginIds.has(pluginId),
    ),
  };
  const rendererTree = projectPluginTree(rendererEligibleTree, "renderer");
  const modules = await Promise.all(
    rendererTree.plugins.map(async (plugin) => {
      const location = await locateCompiledPlugin(
        plugin,
        "renderer",
        cacheRoot,
      );
      return {
        pluginId: plugin.id,
        version: plugin.manifest.version,
        integrity: location.integrity,
        url:
          `termco-plugin://${PLUGIN_HOST}/${encodeURIComponent(plugin.id)}` +
          `/${encodeURIComponent(plugin.manifest.version)}/renderer.mjs` +
          `?integrity=${encodeURIComponent(location.integrity)}`,
      };
    }),
  );
  return serializeRendererBootstrap({
    tree: rendererEligibleTree,
    modules,
    catalog: pluginCatalog(prepared),
  });
}

function pluginCatalog(
  prepared: PreparedProfileProcess,
): RendererBootstrapData["catalog"] {
  const serviceProviders = new Map<string, string[]>();
  for (const provider of prepared.runtime.serviceProviders()) {
    const providers = serviceProviders.get(provider.name) ?? [];
    providers.push(provider.providerId);
    serviceProviders.set(provider.name, providers);
  }
  const moduleInjections = new Map(
    [...prepared.runtime.registeredModules()].map(([pluginId, module]) => [
      pluginId,
      [...(module.inject ?? [])],
    ]),
  );
  const optionalModuleInjections = new Map(
    [...prepared.runtime.registeredModules()].map(([pluginId, module]) => [
      pluginId,
      [...(module.optionalInject ?? [])],
    ]),
  );
  return buildPluginCatalog(
    prepared.profile,
    prepared.tree,
    {
      serviceProviders,
      moduleInjections,
      optionalModuleInjections,
      runtime: {
        process: "main",
        fibers: prepared.runtime.inspect(),
        features: prepared.runtime.inspectFeatures(),
      },
    },
    {
      userPluginsRoot: roots().userPluginsRoot,
      manifests: prepared.manifests,
      essentialReasons: essentialPluginReasons,
    },
  );
}

/** Resolve a renderer module URL only when it matches the active tree. */
export async function readPluginModule(
  requestUrl: string,
): Promise<{ data: Buffer; filePath: string } | null> {
  if (!active) return null;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.hostname !== PLUGIN_HOST) return null;
  const rawSegments = url.pathname.split("/").filter(Boolean);
  if (rawSegments.length < 3) return null;
  let pluginId: string;
  let version: string;
  try {
    pluginId = decodeURIComponent(rawSegments[0] as string);
    version = decodeURIComponent(rawSegments[1] as string);
  } catch {
    return null;
  }
  const plugin = active.tree.plugins.find(
    (entry) =>
      entry.id === pluginId && entry.manifest.version === version,
  );
  if (!plugin?.manifest.entrypoints.renderer) return null;
  const location = await locateCompiledPlugin(
    plugin,
    "renderer",
    cacheRoots(roots()),
  );
  const file = rawSegments[2];
  let filePath: string;
  if (rawSegments.length === 3 && (file === "renderer.mjs" || file === "renderer.mjs.map")) {
    if (url.searchParams.get("integrity") !== location.integrity) return null;
    filePath = file === "renderer.mjs" ? location.entry : `${location.entry}.map`;
  } else {
    if (file !== "assets" || rawSegments.length < 4) return null;
    let assetSegments: string[];
    try {
      assetSegments = rawSegments.slice(3).map(decodeURIComponent);
    } catch {
      return null;
    }
    if (assetSegments.some((segment) =>
      !segment || segment === "." || segment === ".." ||
      segment.includes("/") || segment.includes("\\") || segment.includes("\0"))) {
      return null;
    }
    const assetRoot = resolve(location.root, "assets");
    filePath = resolve(assetRoot, ...assetSegments);
    const assetRelative = relative(assetRoot, filePath);
    if (!assetRelative || assetRelative.startsWith("..") || isAbsolute(assetRelative)) {
      return null;
    }
  }
  return { data: await fs.readFile(filePath), filePath };
}

function sourceFolder(paths: PluginPaths, location: string): string {
  return isAbsolute(location) ? location : resolve(paths.repositoryRoot, location);
}

function activePluginSource(rawPluginId: unknown, requireEditable: boolean) {
  if (typeof rawPluginId !== "string") throw new Error("plugin id is invalid");
  if (!active) throw new Error("plugin runtime is not active");
  const plugin = active.tree.plugins.find(
    (candidate) => candidate.manifest.id === rawPluginId,
  );
  if (!plugin) throw new Error(`active plugin "${rawPluginId}" was not found`);
  if (plugin.source.type === "package") {
    throw new Error(`plugin "${rawPluginId}" must be unpacked before its source can be inspected`);
  }
  if (requireEditable && plugin.source.type !== "local" && plugin.source.mutable !== true) {
    throw new Error(`plugin "${rawPluginId}" is bundled; copy it before editing`);
  }
  return plugin;
}

function selectedPluginSource(rawPluginId: unknown, requireEditable: boolean) {
  if (typeof rawPluginId !== "string") throw new Error("plugin id is invalid");
  if (!active) throw new Error("plugin runtime is not active");
  const row = active.profile.plugins.find((candidate) => {
    const manifest = active?.manifests.get(candidate.id);
    return candidate.id === rawPluginId || manifest?.id === rawPluginId;
  });
  if (!row) throw new Error(`selected plugin "${rawPluginId}" was not found`);
  const manifest = active.manifests.get(row.id);
  if (!manifest) throw new Error(`manifest for plugin "${rawPluginId}" was not found`);
  const source = describePluginSource(row.module);
  if (source.type === "package") {
    throw new Error(`plugin "${rawPluginId}" must be unpacked before its source can be inspected`);
  }
  if (
    requireEditable &&
    source.type !== "local" &&
    source.type !== "file" &&
    source.mutable !== true
  ) {
    throw new Error(`plugin "${rawPluginId}" is bundled; fork or replace it before editing`);
  }
  return { id: row.id, row, manifest, source };
}

async function managedPluginSourceRoot(
  rawPluginId: unknown,
  requireEditable: boolean,
): Promise<string> {
  if (
    typeof rawPluginId !== "string" ||
    !PLUGIN_ID_PATTERN.test(rawPluginId)
  ) {
    throw new Error("plugin id is invalid");
  }
  if (!active) throw new Error("plugin runtime is not active");
  const selected = active.profile.plugins.some((candidate) => {
    const manifest = active?.manifests.get(candidate.id);
    return candidate.id === rawPluginId || manifest?.id === rawPluginId;
  });
  if (selected) {
    const plugin = selectedPluginSource(rawPluginId, requireEditable);
    return fs.realpath(sourceFolder(roots(), plugin.source.location));
  }

  const draft = join(roots().userPluginsRoot, rawPluginId);
  let stat;
  try {
    stat = await fs.lstat(draft);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`managed plugin draft "${rawPluginId}" was not found`);
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`managed plugin draft "${rawPluginId}" is not a real directory`);
  }
  const root = await fs.realpath(draft);
  const manifestResult = parsePluginManifestV3(JSON.parse(
    await fs.readFile(join(root, "termco-plugin.json"), "utf8"),
  ));
  if (!manifestResult.ok) {
    throw new Error(`managed plugin draft manifest is invalid: ${manifestResult.error}`);
  }
  if (manifestResult.manifest.id !== rawPluginId) {
    throw new Error(
      `managed plugin draft id "${manifestResult.manifest.id}" does not match "${rawPluginId}"`,
    );
  }
  return root;
}

async function listPluginDrafts(): Promise<import("@termco/profile-base").PluginDraftItem[]> {
  if (!active) throw new Error("plugin runtime is not active");
  const paths = roots();
  await fs.mkdir(paths.userPluginsRoot, { recursive: true });
  const selectedIds = new Set(active.profile.plugins.flatMap((row) => {
    const manifestId = active?.manifests.get(row.id)?.id;
    return manifestId ? [row.id, manifestId] : [row.id];
  }));
  const drafts: import("@termco/profile-base").PluginDraftItem[] = [];
  for (const entry of await fs.readdir(paths.userPluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || selectedIds.has(entry.name)) {
      continue;
    }
    const folder = join(paths.userPluginsRoot, entry.name);
    try {
      const parsed = parsePluginManifestV3(JSON.parse(
        await fs.readFile(join(folder, "termco-plugin.json"), "utf8"),
      ));
      if (!parsed.ok || selectedIds.has(parsed.manifest.id)) continue;
      drafts.push({
        id: parsed.manifest.id,
        name: parsed.manifest.name,
        description: parsed.manifest.description,
        category: parsed.manifest.category,
        version: parsed.manifest.version,
        sourceFolder: folder,
        ...(parsed.manifest.forkedFrom
          ? { forkedFrom: parsed.manifest.forkedFrom }
          : {}),
        ...(parsed.manifest.replaces
          ? { replaces: parsed.manifest.replaces }
          : {}),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[plugins] ignoring unreadable draft ${entry.name}: ${String(error)}`);
      }
    }
  }
  return drafts.sort((left, right) => left.name.localeCompare(right.name));
}

async function safePluginSourcePath(
  pluginId: unknown,
  rawRelativePath: unknown,
  requireEditable: boolean,
): Promise<{ root: string; file: string; relativePath: string }> {
  if (
    typeof rawRelativePath !== "string" ||
    rawRelativePath.length === 0 ||
    rawRelativePath.includes("\0") ||
    isAbsolute(rawRelativePath)
  ) {
    throw new Error("plugin source path must be a non-empty relative path");
  }
  const root = await managedPluginSourceRoot(pluginId, requireEditable);
  const file = resolve(root, rawRelativePath);
  const rel = relative(root, file).replaceAll("\\", "/");
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error("plugin source path escapes the plugin folder");
  }

  // Never follow a symlink inside a writable plugin tree. This keeps source
  // editing jailed even when a malicious folder was selected manually.
  let current = root;
  for (const segment of rel.split("/")) {
    current = join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`plugin source path contains a symbolic link: ${rel}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return { root, file, relativePath: rel };
}

async function listPluginSourceFiles(rawPluginId: unknown): Promise<string[]> {
  const root = await managedPluginSourceRoot(rawPluginId, false);
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if ([".git", "node_modules", ".termco-cache"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function readPluginSourceFile(rawRequest: unknown): Promise<string> {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("invalid source read request");
  const request = rawRequest as { pluginId?: unknown; relativePath?: unknown };
  const { file } = await safePluginSourcePath(
    request.pluginId,
    request.relativePath,
    false,
  );
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("plugin source path is not a file");
  if (stat.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`plugin source file exceeds ${MAX_SOURCE_FILE_BYTES} bytes`);
  }
  return fs.readFile(file, "utf8");
}

async function writePluginSourceFile(rawRequest: unknown): Promise<void> {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("invalid source write request");
  const request = rawRequest as {
    pluginId?: unknown;
    relativePath?: unknown;
    content?: unknown;
  };
  if (typeof request.content !== "string") throw new Error("plugin source content must be text");
  if (Buffer.byteLength(request.content, "utf8") > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`plugin source content exceeds ${MAX_SOURCE_FILE_BYTES} bytes`);
  }
  const { file } = await safePluginSourcePath(
    request.pluginId,
    request.relativePath,
    true,
  );
  await fs.mkdir(resolve(file, ".."), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, request.content, "utf8");
  await fs.rename(temporary, file);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(resolve(file, ".."), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

async function copyPluginSource(input: {
  paths: PluginPaths;
  sourceRoot: string;
  sourceManifest: TermcoPluginManifestV3;
  replacementId: string;
  mode: "fork" | "replace";
  name?: string;
}): Promise<string> {
  if (basename(input.sourceRoot) !== input.sourceManifest.id) {
    throw new Error(
      `source folder "${basename(input.sourceRoot)}" does not match plugin "${input.sourceManifest.id}"`,
    );
  }
  const target = join(input.paths.userPluginsRoot, input.replacementId);
  if (existsSync(target)) {
    throw new Error(
      `plugin source already exists at ${target}; choose another plugin id`,
    );
  }
  await fs.mkdir(input.paths.userPluginsRoot, { recursive: true });
  await fs.cp(input.sourceRoot, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  const {
    replaces: _replaces,
    forkedFrom: _forkedFrom,
    ...sourceManifest
  } = input.sourceManifest;
  const manifest: TermcoPluginManifestV3 = {
    ...sourceManifest,
    id: input.replacementId,
    name: input.name ?? `${input.sourceManifest.name} (Custom)`,
    ...(input.mode === "replace"
      ? { replaces: input.sourceManifest.id }
      : { forkedFrom: input.sourceManifest.id }),
  };
  await writeJson(join(target, "termco-plugin.json"), manifest);
  try {
    const packageFile = join(target, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageFile, "utf8")) as Record<
      string,
      unknown
    >;
    packageJson.name = `@termco/plugin-${input.replacementId}`;
    await writeJson(packageFile, packageJson);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

function replacementDetail(warning: ReplacementWarning): string {
  const resources = warning.impacts.flatMap((impact) =>
    impact.resources.map(
      (resource) => `${impact.resourceLabel}: ${resource.label} (${resource.id})`,
    ),
  );
  return [
    warning.message,
    resources.length > 0 ? `\nResources that will be destroyed:\n${resources.join("\n")}` : "",
    "\nIf the new plugin fails, the previous provider will be restored, but destroyed live sessions cannot be restored.",
  ].join("");
}

async function confirmReplacement(
  sender: WebContents,
  warning: ReplacementWarning,
): Promise<boolean> {
  if (
    process.env.TERMCO_E2E === "1" &&
    process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT === "1"
  ) {
    return true;
  }
  const parent = BrowserWindow.fromWebContents(sender) ?? undefined;
  const result = await dialog.showMessageBox(parent, {
    type: "warning",
    title: "Replace plugin while Termco is running?",
    message: "This replacement will stop live resources",
    detail: replacementDetail(warning),
    buttons: ["Cancel", "Stop resources and replace"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}

async function rollbackTo(
  previous: PreparedProfileProcess,
  previousRenderer: RendererBootstrapData,
  replaced: PreparedProfileProcess,
  replacedRenderer: RendererBootstrapData,
  allowPendingPluginIds: ReadonlySet<string>,
): Promise<void> {
  if (!liveController || !ipcHost) throw new Error("live runtime is unavailable");
  const externallyChangedPluginIds = changedPluginIds(
    replaced.tree,
    previous.tree,
  );
  const {
    rendererChangedPluginIds,
    rendererChangedServiceNames,
    drainProviderPluginIds,
  } =
    replacementPluginScopes(replaced.runtime, externallyChangedPluginIds);
  await runBackwardReplacement({
    quiesceCandidateRenderer: () =>
      ipcHost.quiesceRendererProfiles(
        previousRenderer,
        rendererChangedPluginIds,
        drainProviderPluginIds,
        rendererChangedServiceNames,
      ),
    restoreCandidateRenderer: () =>
      ipcHost.restoreRendererProfiles(replacedRenderer),
    restoreMain: async () => {
      await liveController.replace(
        previous.processTree,
        previous.loadModule,
        () => true,
        { externallyChangedPluginIds, allowPendingPluginIds },
      );
      previous.runtime = liveController.runtime;
      active = previous;
    },
    installPreviousRouter() {
      ipcHost.update(
        new CapabilityRpcRouter(previous.tree, previous.runtime),
        previousRenderer,
      );
    },
    activatePreviousRenderer: () =>
      ipcHost.restoreRendererProfiles(previousRenderer),
  });
}

async function activateProfileLayer(input: {
  sender: WebContents;
  paths: PluginPaths;
  previous: PreparedProfileProcess;
  profile: TermcoProfileV3;
  persistProfile?: boolean;
  allowPendingPluginIds?: ReadonlySet<string>;
  beforeRendererActivation?: (
    candidate: PreparedProfileProcess,
  ) => Promise<void>;
}): Promise<ReplacementResult> {
  const controller = liveController;
  const transport = ipcHost;
  if (!controller || !transport) throw new Error("live runtime is unavailable");
  const profileDirectory = join(input.paths.userProfilesRoot, input.profile.id);
  if (input.persistProfile !== false) {
    await writeJson(join(profileDirectory, "profile.json"), input.profile);
  }
  const candidate = await prepareProfileProcess({
    repositoryRoot: input.paths.repositoryRoot,
    profilesRoot: profileRoots(input.paths),
    activeProfileId: input.profile.id,
    cacheRoot: cacheRoots(input.paths),
    process: "main",
  });

  // Tree identity must compare the code generations that will execute, not an
  // unqualified source row on one side and a previously loaded SHA on the
  // other. Otherwise an unrelated Apply appears to replace the entire graph
  // and can prompt to destroy live resources.
  await Promise.all([
    qualifyCompiledPluginGenerations(
      input.previous.tree,
      cacheRoots(input.paths),
    ),
    qualifyCompiledPluginGenerations(candidate.tree, cacheRoots(input.paths)),
  ]);

  const previousRenderer = await createRendererBootstrap(
    input.previous,
    cacheRoots(input.paths),
  );
  const previousPendingPluginIds = new Set(
    input.previous.runtime
      .inspect()
      .filter((fiber) => fiber.state === "pending")
      .map((fiber) => fiber.pluginId),
  );
  const candidateRendererPlan = await createRendererBootstrap(
    candidate,
    cacheRoots(input.paths),
  );
  const externallyChangedPluginIds = changedPluginIds(
    input.previous.tree,
    candidate.tree,
  );
  const previousDirectChangedServices = new Set(
    input.previous.runtime
      .serviceProviders()
      .filter((provider) => externallyChangedPluginIds.has(provider.providerId))
      .map((provider) => provider.name),
  );
  const {
    rendererChangedPluginIds,
    rendererChangedServiceNames,
    drainProviderPluginIds,
  } =
    replacementPluginScopes(
      input.previous.runtime,
      externallyChangedPluginIds,
    );
  let result: ReplacementResult;
  try {
    result = await runForwardReplacement({
      replaceMain: (beforeDeactivate) =>
        controller.replace(
          candidate.processTree,
          candidate.loadModule,
          (warning) => confirmReplacement(input.sender, warning),
          {
            candidateRuntime: candidate.runtime,
            externallyChangedPluginIds,
            beforeDeactivate,
            allowPendingPluginIds: input.allowPendingPluginIds,
          },
        ),
      quiesceRenderer: () =>
        transport.quiesceRendererProfiles(
          candidateRendererPlan,
          rendererChangedPluginIds,
          drainProviderPluginIds,
          rendererChangedServiceNames,
        ),
      restorePreviousRenderer: () =>
        transport.restoreRendererProfiles(previousRenderer),
    });
  } catch (error) {
    if (error instanceof RendererConvergenceError) {
      throw new LiveReplacementError(
        "rollback",
        error,
        false,
        [],
      );
    }
    throw error;
  }
  if (result.status === "cancelled") return result;

  candidate.runtime = controller.runtime;
  const returnedDirectServiceNames = candidate.runtime
    .serviceProviders()
    .filter(
      (provider) =>
        externallyChangedPluginIds.has(provider.providerId) &&
        !previousDirectChangedServices.has(provider.name),
    )
    .map((provider) => provider.name);
  let candidateRenderer = candidateRendererPlan;
  try {
    candidateRenderer = await createRendererBootstrap(
      candidate,
      cacheRoots(input.paths),
    );
    active = candidate;
    transport.update(
      new CapabilityRpcRouter(candidate.tree, candidate.runtime),
      candidateRenderer,
    );
    await input.beforeRendererActivation?.(candidate);
    await transport.replaceRendererProfiles(candidateRenderer, [
      ...new Set([
        ...rendererChangedServiceNames,
        ...returnedDirectServiceNames,
      ]),
    ]);
  } catch (error) {
    try {
      await rollbackTo(
        input.previous,
        previousRenderer,
        candidate,
        candidateRenderer,
        previousPendingPluginIds,
      );
    } catch (rollbackError) {
      throw new LiveReplacementError(
        "rollback",
        new AggregateError(
          [error, rollbackError],
          "renderer activation failed and rollback failed",
        ),
        false,
        result.warning?.impacts ?? [],
      );
    }
    throw new LiveReplacementError(
      "renderer-activation",
      error,
      true,
      result.warning?.impacts ?? [],
    );
  }

  try {
    await writeJson(input.paths.activeProfileFile, {
      profileId: input.profile.id,
    });
  } catch (error) {
    try {
      await rollbackTo(
        input.previous,
        previousRenderer,
        candidate,
        candidateRenderer,
        previousPendingPluginIds,
      );
    } catch (rollbackError) {
      throw new LiveReplacementError(
        "rollback",
        new AggregateError(
          [error, rollbackError],
          "profile persistence failed and rollback failed",
        ),
        false,
        result.warning?.impacts ?? [],
      );
    }
    throw new LiveReplacementError(
      "persistence",
      error,
      true,
      result.warning?.impacts ?? [],
    );
  }
  enabledPreviews.advance();
  return {
    ...result,
  };
}

async function recoverRendererProfile(
  sender: WebContents,
  rawRequest: unknown,
): Promise<{ status: "replaced"; profileId: string }> {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("renderer recovery request is invalid");
  }
  const request = rawRequest as {
    requestedProfileId?: unknown;
    message?: unknown;
  };
  if (
    typeof request.requestedProfileId !== "string" ||
    typeof request.message !== "string" ||
    request.message.length === 0 ||
    request.message.length > 20_000
  ) {
    throw new Error("renderer recovery details are invalid");
  }
  const previous = active;
  if (!previous || previous.profile.id !== request.requestedProfileId) {
    throw new Error("selected profile changed before renderer recovery");
  }
  const paths = roots();
  const profiles = await loadProfileDirectories(profileRoots(paths));
  const profile = profiles.get(SAFE_PROFILE_ID);
  if (!profile) throw new Error(`profile "${SAFE_PROFILE_ID}" does not exist`);
  const result = await activateProfileLayer({
    sender,
    paths,
    previous,
    profile,
    persistProfile: false,
    beforeRendererActivation: (candidate) =>
      recordProfileBootFailure(
        candidate.runtime,
        request.requestedProfileId as string,
        new Error(request.message as string),
      ),
  });
  if (result.status !== "replaced") {
    throw new Error("renderer recovery was cancelled");
  }
  return { status: "replaced", profileId: SAFE_PROFILE_ID };
}

function selectedPluginRow(rawRequest: unknown): {
  pluginId: string;
  enabled: boolean;
  row: ProfilePluginRowV3;
  manifest: TermcoPluginManifestV3;
  prepared: PreparedProfileProcess;
} {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("invalid plugin activation request");
  }
  const request = rawRequest as { pluginId?: unknown; enabled?: unknown };
  if (typeof request.pluginId !== "string" || typeof request.enabled !== "boolean") {
    throw new Error("plugin activation requires a plugin id and enabled state");
  }
  const prepared = active;
  if (!prepared || !liveController || !ipcHost) {
    throw new Error("plugin runtime is not active");
  }
  const row = prepared.profile.plugins.find((candidate) => {
    const manifest = prepared.manifests.get(candidate.id);
    return candidate.id === request.pluginId || manifest?.id === request.pluginId;
  });
  if (!row) throw new Error(`profile plugin "${request.pluginId}" was not found`);
  const manifest = prepared.manifests.get(row.id);
  if (!manifest?.entrypoints) {
    throw new Error(`profile row "${row.id}" is not an executable plugin`);
  }
  const essentialReason = essentialPluginReasons.get(row.id);
  if (!request.enabled && essentialReason) {
    throw new Error(`${manifest.name} cannot be disabled. ${essentialReason}`);
  }
  return {
    pluginId: manifest.id,
    enabled: request.enabled,
    row,
    manifest,
    prepared,
  };
}

async function previewSetPluginEnabled(
  sender: WebContents,
  rawRequest: unknown,
): Promise<PluginDisableImpact> {
  await reconcileActiveMissingManagedPlugins(sender);
  const request = selectedPluginRow(rawRequest);
  const impact = request.enabled
    ? {
        blockedPlugins: [],
        unavailableFeatures: [],
        degradedPlugins: [],
        destructiveResources: [],
      }
    : await (async () => {
        const mainImpact = await request.prepared.runtime.previewPluginRemoval(
          request.pluginId,
        );
        const rendererImpacts = await Promise.all(
          [
            request.pluginId,
            ...mainImpact.blockedPlugins.map((plugin) => plugin.pluginId),
          ].map((pluginId) =>
            (ipcHost as CapabilityIpcHost).inspectRendererPluginRemoval(
              pluginId,
            ),
          ),
        );
        return mergePluginRemovalImpacts([mainImpact, ...rendererImpacts]);
      })();
  const previewId = randomUUID();
  const confirmation = enabledPreviews.issue(
    request.pluginId,
    request.enabled,
    previewId,
  );
  return {
    previewId,
    generation: confirmation.generation,
    pluginId: request.pluginId,
    enabled: request.enabled,
    ...impact,
  };
}

async function activateNamedProfile(
  sender: WebContents,
  rawProfileId: unknown,
): Promise<{
  status: "replaced" | "cancelled";
  profileId: string;
  warning?: { message: string };
}> {
  if (
    typeof rawProfileId !== "string" ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(rawProfileId)
  ) {
    throw new Error("profile id is invalid");
  }
  const previous = active;
  if (!previous || !liveController || !ipcHost) {
    throw new Error("plugin runtime is not active");
  }
  const paths = roots();
  await reconcileGeneratedUserProfile(paths, rawProfileId);
  const profiles = await loadProfileDirectories(profileRoots(paths));
  if (!profiles.has(rawProfileId)) {
    throw new Error(`profile "${rawProfileId}" does not exist`);
  }
  const profile = profiles.get(rawProfileId) as TermcoProfileV3;
  let defaults: Record<string, unknown> = {};
  if (rawProfileId.startsWith("imported.")) {
    const document = JSON.parse(
      await fs.readFile(
        join(paths.userProfilesRoot, rawProfileId, "profile", "defaults.json"),
        "utf8",
      ),
    ) as { schemaVersion?: unknown; values?: unknown };
    if (document.schemaVersion !== 1) throw new Error("installed profile defaults schema is invalid");
    defaults = validateProfileDefaults(document.values);
  }
  const previousDefaults = Object.keys(defaults).length > 0
    ? await previous.runtime.callCapability(
        "settings.preferences",
        "getMany",
        [Object.keys(defaults)],
      ) as Record<string, unknown>
    : {};
  let defaultsApplied = false;
  let result: Awaited<ReturnType<typeof activateProfileLayer>>;
  try {
    result = await activateProfileLayer({
      sender,
      paths,
      previous,
      profile,
      persistProfile: false,
      beforeRendererActivation: async (candidate) => {
        for (const [key, value] of Object.entries(defaults)) {
          await candidate.runtime.callCapability("settings.preferences", "set", [key, value]);
        }
        defaultsApplied = Object.keys(defaults).length > 0;
      },
    });
  } catch (error) {
    if (defaultsApplied) {
      for (const key of Object.keys(defaults)) {
        if (Object.hasOwn(previousDefaults, key)) {
          await previous.runtime.callCapability("settings.preferences", "set", [key, previousDefaults[key]]);
        } else {
          await previous.runtime.callCapability("settings.preferences", "delete", [key]);
        }
      }
    }
    throw error;
  }
  return {
    status: result.status,
    profileId: result.status === "replaced" ? profile.id : previous.profile.id,
    ...(result.warning
      ? { warning: { message: result.warning.message } }
      : {}),
  };
}

const PLUGIN_CREATION_TARGETS = new Set<PluginCreationTarget>([
  ...UI_CONTRIBUTION_AUTHORING_DESCRIPTORS.map(
    (descriptor) => descriptor.service,
  ),
  "main-provider",
  "renderer-provider",
  "server",
]);

function parsePluginCreateRequest(rawRequest: unknown): PluginCreateRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("plugin creation request is invalid");
  }
  const request = rawRequest as Partial<Record<keyof PluginCreateRequest, unknown>>;
  if (
    typeof request.id !== "string" ||
    request.id.length > 80 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(request.id)
  ) {
    throw new Error("plugin id must contain lowercase letters, numbers, dots, or hyphens");
  }
  const text = (field: "name" | "description" | "category", max: number) => {
    const value = request[field];
    if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
      throw new Error(`plugin ${field} is invalid`);
    }
    return value.trim();
  };
  if (
    typeof request.target !== "string" ||
    !PLUGIN_CREATION_TARGETS.has(request.target as PluginCreationTarget)
  ) {
    throw new Error("plugin creation target is invalid");
  }
  if (
    request.variant !== undefined &&
    (typeof request.variant !== "string" || request.variant.trim().length === 0)
  ) {
    throw new Error("plugin creation variant is invalid");
  }
  return {
    id: request.id,
    name: text("name", 120),
    description: text("description", 500),
    category: text("category", 100),
    target: request.target as PluginCreationTarget,
    ...(typeof request.variant === "string"
      ? { variant: request.variant.trim() }
      : {}),
  };
}

export function planPlugin(rawRequest: unknown): PluginAuthoringPlanResult {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("plugin authoring plan is invalid");
  }
  const request = rawRequest as PluginAuthoringPlanRequest;
  if (!["create", "fork", "replace"].includes(request.intent)) {
    throw new Error("plugin authoring intent is invalid");
  }
  const plugin = parsePluginCreateRequest({
    ...request.plugin,
    target: request.target,
    ...(request.variant ? { variant: request.variant } : {}),
  });
  if (request.intent === "create" && request.sourcePluginId) {
    throw new Error("a create plan cannot select a source plugin");
  }
  if (
    request.intent !== "create" &&
    (typeof request.sourcePluginId !== "string" ||
      !PLUGIN_ID_PATTERN.test(request.sourcePluginId))
  ) {
    throw new Error(`a ${request.intent} plan requires a valid source plugin`);
  }
  if (request.sourcePluginId === plugin.id) {
    throw new Error("the planned plugin id must differ from its source");
  }
  if (!Array.isArray(request.contributions)) {
    throw new Error("plugin authoring contribution proofs are invalid");
  }
  if (!["auto", "offer", "none"].includes(request.reveal)) {
    throw new Error("plugin authoring reveal policy is invalid");
  }
  if (request.onboarding !== undefined) {
    const onboarding = request.onboarding as Partial<PluginOnboardingPlan> & {
      journey?: { steps?: unknown[]; presentation?: unknown };
    };
    if (
      !["include", "omit", "not-applicable"].includes(String(onboarding.decision)) ||
      typeof onboarding.rationale !== "string" ||
      onboarding.rationale.trim().length === 0 ||
      (onboarding.decision === "include" &&
        (!onboarding.journey ||
          !Array.isArray(onboarding.journey.steps) ||
          onboarding.journey.steps.length === 0 ||
          !["contextual", "available"].includes(String(onboarding.journey.presentation))))
    ) {
      throw new Error("plugin authoring onboarding plan is invalid");
    }
  }
  const plan: PluginAuthoringPlanResult = {
    planId: randomUUID(),
    intent: request.intent,
    plugin: {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      category: plugin.category,
    },
    ...(request.sourcePluginId
      ? { sourcePluginId: request.sourcePluginId }
      : {}),
    target: plugin.target,
    ...(plugin.variant ? { variant: plugin.variant } : {}),
    contributions: structuredClone(request.contributions),
    reveal: request.reveal,
    ...(request.onboarding
      ? { onboarding: structuredClone(request.onboarding) }
      : {}),
  };
  pluginAuthoringPlans.set(plan.planId, { plan, used: false });
  return plan;
}

export function plannedMutation(
  rawPlanId: unknown,
  intent: PluginAuthoringPlanRequest["intent"],
): { plan: PluginAuthoringPlanResult; markUsed(): void } {
  if (typeof rawPlanId !== "string") throw new Error("plugin plan id is invalid");
  const stored = pluginAuthoringPlans.get(rawPlanId);
  if (!stored) throw new Error(`plugin authoring plan "${rawPlanId}" was not found`);
  if (stored.used) throw new Error(`plugin authoring plan "${rawPlanId}" was already used`);
  if (stored.plan.intent !== intent) {
    throw new Error(
      `plugin authoring plan "${rawPlanId}" is ${stored.plan.intent}, not ${intent}`,
    );
  }
  return {
    plan: stored.plan,
    markUsed() { stored.used = true; },
  };
}

async function createPlugin(
  _sender: WebContents,
  rawPlanId: unknown,
): Promise<PluginCreateResult> {
  const mutation = plannedMutation(rawPlanId, "create");
  const request: PluginCreateRequest = {
    ...mutation.plan.plugin,
    target: mutation.plan.target,
    ...(mutation.plan.variant ? { variant: mutation.plan.variant } : {}),
    ...(mutation.plan.onboarding
      ? { onboarding: mutation.plan.onboarding }
      : {}),
  };
  const previous = active;
  if (!previous) {
    throw new Error("plugin runtime is not active");
  }
  if (
    previous.profile.plugins.some((row) =>
      previous.manifests.get(row.id)?.id === request.id || row.id === request.id,
    )
  ) {
    throw new Error(`plugin "${request.id}" is already selected`);
  }

  const paths = roots();
  const target = join(paths.userPluginsRoot, request.id);
  if (existsSync(target)) {
    throw new Error(`plugin folder already exists at ${target}`);
  }
  const cacheTarget = join(paths.userCacheRoot, request.id);
  const scaffold = scaffoldPlugin(request);
  try {
    await fs.mkdir(paths.userPluginsRoot, { recursive: true });
    await fs.mkdir(target, { recursive: false });
    await writeJson(join(target, "termco-plugin.json"), scaffold.manifest);
    for (const [relativePath, content] of scaffold.files) {
      const file = join(target, relativePath);
      await fs.mkdir(resolve(file, ".."), { recursive: true });
      await fs.writeFile(file, content, "utf8");
    }
    const compiled = await compileLivePlugin({
      repositoryRoot: paths.repositoryRoot,
      pluginRoot: target,
      cacheRoot: paths.userCacheRoot,
    });
    const result: PluginCreateResult = {
      status: "draft",
      pluginId: compiled.manifest.id,
      sourceFolder: target,
      stages: {
        scaffolded: true,
        validated: true,
        compiled: true,
        profileCommitted: false,
        graphSettled: false,
        contributionRegistered: null,
        visiblyVerified: false,
      },
    };
    mutation.markUsed();
    return result;
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    await fs.rm(cacheTarget, { recursive: true, force: true });
    throw error;
  }
}

async function forkPlugin(
  _sender: WebContents,
  rawPlanId: unknown,
): Promise<PluginForkResult> {
  const mutation = plannedMutation(rawPlanId, "fork");
  const request: PluginForkRequest = {
    pluginId: mutation.plan.sourcePluginId!,
    forkId: mutation.plan.plugin.id,
    name: mutation.plan.plugin.name,
  };
  const previous = active;
  if (!previous) {
    throw new Error("plugin runtime is not active");
  }
  if (request.pluginId === request.forkId) {
    throw new Error("a fork must have a new plugin id");
  }
  if (
    previous.profile.plugins.some((row) =>
      row.id === request.forkId ||
      previous.manifests.get(row.id)?.id === request.forkId
    )
  ) {
    throw new Error(`plugin "${request.forkId}" is already selected`);
  }

  const paths = roots();
  const source = selectedPluginSource(request.pluginId, false);
  const target = join(paths.userPluginsRoot, request.forkId);
  const cacheTarget = join(paths.userCacheRoot, request.forkId);
  try {
    await copyPluginSource({
      paths,
      sourceRoot: sourceFolder(paths, source.source.location),
      sourceManifest: source.manifest,
      replacementId: request.forkId,
      mode: "fork",
      name: request.name,
    });
    const compiled = await compileLivePlugin({
      repositoryRoot: paths.repositoryRoot,
      pluginRoot: target,
      cacheRoot: paths.userCacheRoot,
    });
    const result: PluginForkResult = {
      status: "forked",
      pluginId: compiled.manifest.id,
      sourceFolder: target,
      stages: {
        scaffolded: true,
        validated: true,
        compiled: true,
        profileCommitted: false,
        graphSettled: false,
        contributionRegistered: null,
        visiblyVerified: false,
      },
    };
    mutation.markUsed();
    return result;
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    await fs.rm(cacheTarget, { recursive: true, force: true });
    throw error;
  }
}

async function copyAndReplacePlugin(
  _sender: WebContents,
  rawPlanId: unknown,
): Promise<CopyAndReplacePluginResult> {
  const mutation = plannedMutation(rawPlanId, "replace");
  const request: CopyAndReplacePluginRequest = {
    pluginId: mutation.plan.sourcePluginId!,
    replacementId: mutation.plan.plugin.id,
    name: mutation.plan.plugin.name,
  };
  const previous = active;
  if (!previous || !liveController || !ipcHost) {
    throw new Error("plugin runtime is not active");
  }
  if (request.pluginId === request.replacementId) {
    throw new Error("a replacement must have a new plugin id");
  }
  if (previous.tree.plugins.some((plugin) => plugin.manifest.id === request.replacementId)) {
    throw new Error(`plugin "${request.replacementId}" is already selected`);
  }

  const paths = roots();
  const source = previous.tree.plugins.find(
    (plugin) => plugin.manifest.id === request.pluginId,
  );
  if (!source) throw new Error(`active plugin "${request.pluginId}" was not found`);
  if (source.source.type === "package") {
    throw new Error("package plugin sources must be unpacked before they can be copied");
  }

  const target = await copyPluginSource({
    paths,
    sourceRoot: sourceFolder(paths, source.source.location),
    sourceManifest: source.manifest,
    replacementId: request.replacementId,
    mode: "replace",
    name: request.name,
  });
  const compiled = await compileLivePlugin({
    repositoryRoot: paths.repositoryRoot,
    pluginRoot: target,
    cacheRoot: paths.userCacheRoot,
  });

  const result: CopyAndReplacePluginResult = {
    status: "draft",
    pluginId: compiled.manifest.id,
    sourceFolder: target,
    generation: null,
    completionId: null,
  };
  mutation.markUsed();
  return result;
}

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`plugin version "${version}" is not valid semver`);
  return `${match[1]}.${match[2]}.${Number.parseInt(match[3], 10) + 1}`;
}

export function replaceProfileRow(
  rows: readonly ProfilePluginRowV3[],
  targetId: string,
  replacementId: string,
  module: string,
): ProfilePluginRowV3[] {
  let replaced = false;
  const next = rows.flatMap((row) => {
    if (row.id !== targetId) return { ...row };
    replaced = true;
    if (targetId === replacementId) {
      return { ...row, module };
    }
    return [
      { ...row, enabled: false, disabledBy: replacementId },
      { id: replacementId, module },
    ];
  });
  if (!replaced) {
    throw new Error(`active profile row "${targetId}" was not found`);
  }
  return next;
}

export function releaseReplacementProfileRows(
  rows: readonly ProfilePluginRowV3[],
  replacementRowId: string,
  replacedPluginId: string,
): ProfilePluginRowV3[] {
  return rows.map((row) => {
    if (
      row.enabled === false &&
      (row.disabledBy === replacementRowId || row.id === replacedPluginId)
    ) {
      const {
        enabled: _disabled,
        disabledBy: _replacementOwner,
        ...restored
      } = row;
      return restored;
    }
    return { ...row };
  });
}

export function profileRowsAfterUninstall(
  rows: readonly ProfilePluginRowV3[],
  plugin: { id: string; replaces?: string },
): ProfilePluginRowV3[] {
  let restored = plugin.replaces === undefined;
  const next = rows.flatMap((row) => {
    if (row.id === plugin.id) return [];
    if (
      (row.disabledBy === plugin.id ||
        (plugin.replaces !== undefined && row.id === plugin.replaces)) &&
      row.enabled === false
    ) {
      restored = true;
      const {
        enabled: _disabled,
        disabledBy: _replacementOwner,
        ...original
      } = row;
      return original;
    }
    return { ...row };
  });
  if (!restored) {
    throw new Error(
      `replacement plugin "${plugin.id}" has no preserved original row "${plugin.replaces}"`,
    );
  }
  return next;
}

export function profileRowsWithEnabled(
  rows: readonly ProfilePluginRowV3[],
  targetId: string,
  enabled: boolean,
): ProfilePluginRowV3[] {
  let changed = false;
  const next = rows.map((row) => {
    if (row.id !== targetId) return { ...row };
    changed = true;
    if (!enabled) return { ...row, enabled: false };
    const {
      enabled: _disabled,
      disabledBy: _replacementOwner,
      ...selected
    } = row;
    return selected;
  });
  if (!changed) throw new Error(`profile row "${targetId}" was not found`);
  return next;
}

async function setPluginEnabled(
  sender: WebContents,
  rawRequest: unknown,
): Promise<{
  status: "replaced" | "cancelled";
  pluginId: string;
  enabled: boolean;
  warning?: { message: string };
}> {
  const requestedPluginId =
    rawRequest && typeof rawRequest === "object"
      ? (rawRequest as { pluginId?: unknown }).pluginId
      : undefined;
  const repair = await reconcileActiveMissingManagedPlugins(sender);
  if (
    typeof requestedPluginId === "string" &&
    repair.removedPluginIds.includes(requestedPluginId)
  ) {
    return {
      status: "replaced",
      pluginId: requestedPluginId,
      enabled: false,
      warning: {
        message:
          "The plugin entry was removed because its managed source folder no longer exists.",
      },
    };
  }
  const request = selectedPluginRow(rawRequest);
  const previous = request.prepared;
  const { row, manifest } = request;
  const confirmation = (rawRequest as { confirmation?: unknown }).confirmation as
    | Partial<PluginEnableConfirmation>
    | undefined;
  if (
    !confirmation ||
    typeof confirmation.previewId !== "string" ||
    typeof confirmation.generation !== "number"
  ) {
    throw new Error("plugin activation requires a confirmed impact preview");
  }
  enabledPreviews.consume(request.pluginId, request.enabled, {
    previewId: confirmation.previewId,
    generation: confirmation.generation,
  });
  const currentlyEnabled = row.enabled !== false;
  if (currentlyEnabled === request.enabled) {
    return {
      status: "replaced",
      pluginId: manifest.id,
      enabled: currentlyEnabled,
    };
  }
  const profile: TermcoProfileV3 = {
    schemaVersion: 3,
    id: `termco.user.${Date.now()}.${randomUUID().slice(0, 8)}`,
    bundles: [],
    plugins: profileRowsWithEnabled(
      previous.profile.plugins,
      row.id,
      request.enabled,
    ),
    patches: [],
  };
  const allowedPending = request.enabled
    ? new Set<string>()
    : new Set(
        (
          await previous.runtime.previewPluginRemoval(request.pluginId)
        ).blockedPlugins.map((plugin) => plugin.pluginId),
      );
  const result = await activateProfileLayer({
    sender,
    paths: roots(),
    previous,
    profile,
    allowPendingPluginIds: allowedPending,
  });
  return {
    status: result.status,
    pluginId: manifest.id,
    enabled: result.status === "replaced" ? request.enabled : currentlyEnabled,
    ...(result.warning ? { warning: { message: result.warning.message } } : {}),
  };
}

function profilePackageSlug(name: string): string {
  const slug = name.trim().toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) throw new Error("profile name must contain a letter or number");
  return slug;
}

function profileExportRequest(value: unknown): ProfileExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("profile export request is invalid");
  }
  const request = value as Record<string, unknown>;
  if (
    typeof request.name !== "string" ||
    typeof request.description !== "string" ||
    typeof request.version !== "string"
  ) throw new Error("profile export name, description, and version are required");
  return {
    name: request.name,
    description: request.description,
    version: request.version,
  };
}

function personalProfileName(profileId: string): string {
  const timestamp = GENERATED_USER_PROFILE_ID.test(profileId)
    ? Number(profileId.split(".")[2])
    : Number.NaN;
  if (!Number.isFinite(timestamp)) return "Personal profile";
  return `Personal profile · ${new Date(timestamp).toLocaleDateString()}`;
}

async function profileManagementSnapshot(): Promise<ProfileManagementSnapshot> {
  const current = active;
  if (!current) throw new Error("plugin runtime is not active");
  const paths = roots();
  const profiles = await loadProfileDirectories(profileRoots(paths));
  const summaries = await Promise.all([...profiles.values()].map(async (profile) => {
    let name = profile.id === "termco.default" ? "Termco Default" : personalProfileName(profile.id);
    let description = profile.id === "termco.default"
      ? "The complete profile shipped with Termco."
      : "A developer-owned profile created by local customization.";
    let version: string | undefined;
    let kind: "default" | "personal" | "imported" = profile.id === "termco.default"
      ? "default"
      : "personal";
    try {
      const manifest = JSON.parse(
        await fs.readFile(join(paths.userProfilesRoot, profile.id, "termco-profile.json"), "utf8"),
      ) as { name?: unknown; description?: unknown; version?: unknown };
      if (typeof manifest.name === "string") name = manifest.name;
      if (typeof manifest.description === "string") description = manifest.description;
      if (typeof manifest.version === "string") version = manifest.version;
      kind = "imported";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const inactivePluginCount = profile.plugins.filter((row) => row.enabled === false).length;
    const customPluginCount = profile.plugins.filter((row) => !row.module.startsWith("bundled:")).length;
    return {
      id: profile.id,
      name,
      description,
      ...(version ? { version } : {}),
      kind,
      active: profile.id === current.profile.id,
      pluginCount: profile.plugins.length,
      inactivePluginCount,
      customPluginCount,
    };
  }));
  summaries.sort((left, right) =>
    Number(right.active) - Number(left.active) ||
    (left.kind === "default" ? -1 : right.kind === "default" ? 1 : 0) ||
    left.name.localeCompare(right.name)
  );
  return { activeProfileId: current.profile.id, profiles: summaries };
}

async function exportActiveProfile(
  sender: WebContents,
  rawRequest: unknown,
): Promise<ProfileExportResult> {
  const current = active;
  if (!current) throw new Error("plugin runtime is not active");
  const request = profileExportRequest(rawRequest);
  const slug = profilePackageSlug(request.name);
  const packageId = `company.${slug}`;
  const paths = roots();
  const pluginSources = current.tree.plugins.flatMap((plugin) => {
    if (plugin.source.type === "bundled") return [];
    if (plugin.source.type === "package") {
      throw new Error(`plugin "${plugin.manifest.id}" must be unpacked before this profile can be exported`);
    }
    return [{
      rowId: plugin.id,
      pluginId: plugin.manifest.id,
      version: plugin.manifest.version,
      root: sourceFolder(paths, plugin.source.location),
    }];
  });
  const created = await createProfilePackage({
    id: packageId,
    name: request.name,
    description: request.description,
    version: request.version,
    termcoVersion: app.getVersion(),
    profile: snapshotProfile(current.profile),
    defaults: await current.runtime.callCapability(
      "settings.preferences",
      "getMany",
      [[...PROFILE_DEFAULT_KEYS]],
    ) as Record<string, unknown>,
    pluginSources,
  });
  const suggested = `${slug}-${request.version}.termco-profile.zip`;
  let target = process.env.TERMCO_E2E_PROFILE_EXPORT_PATH;
  if (!target) {
    const selected = await dialog.showSaveDialog(
      BrowserWindow.fromWebContents(sender) ?? undefined,
      {
        title: "Export Termco Profile",
        defaultPath: suggested,
        filters: [{ name: "Termco Profile Package", extensions: ["zip"] }],
      },
    );
    if (selected.canceled || !selected.filePath) return { status: "cancelled" };
    target = selected.filePath;
  }
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(dirname(target), { recursive: true });
  try {
    await fs.writeFile(temporary, created.bytes);
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  return {
    status: "exported",
    path: target,
    name: created.manifest.name,
    version: created.manifest.version,
    pluginCount: current.profile.plugins.length,
    packagedPluginCount: created.manifest.plugins.length,
  };
}

async function importProfilePackage(sender: WebContents): Promise<ProfileImportResult> {
  const paths = roots();
  let selected = process.env.TERMCO_E2E_PROFILE_IMPORT_PATH;
  if (!selected) {
    const picked = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(sender) ?? undefined,
      {
        title: "Import Termco Profile",
        properties: ["openFile"],
        filters: [{ name: "Termco Profile Package", extensions: ["zip"] }],
      },
    );
    selected = picked.filePaths[0];
    if (picked.canceled || !selected) return { status: "cancelled" };
  }
  const bytes = new Uint8Array(await fs.readFile(selected));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const parsed = parseProfilePackage(bytes);
  const versionId = parsed.manifest.version.replace(/[^a-z0-9]+/gi, ".").toLocaleLowerCase();
  const localProfileId = `imported.${parsed.manifest.id}.${versionId}`;
  const target = join(paths.userProfilesRoot, localProfileId);
  try {
    const installedDigest = (await fs.readFile(join(target, ".package.sha256"), "utf8")).trim();
    if (installedDigest === digest) {
      return {
        status: "already-installed",
        profileId: localProfileId,
        name: parsed.manifest.name,
        version: parsed.manifest.version,
        pluginCount: parsed.profile.plugins.length,
        packagedPluginCount: parsed.manifest.plugins.length,
      };
    }
    throw new Error(`${parsed.manifest.name} ${parsed.manifest.version} is already installed with different content`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.mkdir(paths.profileStagingRoot, { recursive: true });
  const staging = join(paths.profileStagingRoot, `${localProfileId}.${randomUUID()}`);
  await fs.mkdir(staging, { recursive: true });
  try {
    await writeParsedProfilePackage(parsed, staging);
    for (const artifact of parsed.manifest.plugins) {
      await compileLivePlugin({
        repositoryRoot: paths.repositoryRoot,
        pluginRoot: join(staging, ...artifact.path.split("/")),
        cacheRoot: paths.userCacheRoot,
      });
    }
    const profile: TermcoProfileV3 = {
      ...structuredClone(parsed.profile),
      id: localProfileId,
      plugins: parsed.profile.plugins.map((row) => {
        if (!row.module.startsWith("package:")) return { ...row };
        const artifactPath = row.module.slice("package:".length);
        return {
          ...row,
          module: pathToFileURL(join(target, ...artifactPath.split("/"))).href,
        };
      }),
    };
    await writeJson(join(staging, "profile.json"), profile);
    await fs.writeFile(join(staging, ".package.sha256"), `${digest}\n`, "utf8");
    await fs.mkdir(paths.userProfilesRoot, { recursive: true });
    await fs.rename(staging, target);
    return {
      status: "imported",
      profileId: localProfileId,
      name: parsed.manifest.name,
      version: parsed.manifest.version,
      pluginCount: profile.plugins.length,
      packagedPluginCount: parsed.manifest.plugins.length,
    };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function openPluginsFolder(): Promise<{ path: string }> {
  const path = roots().userPluginsRoot;
  await fs.mkdir(path, { recursive: true });
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
  return { path };
}

async function openPluginFolder(
  sender: WebContents,
  rawPluginId: unknown,
): Promise<{ path: string }> {
  const repair = await reconcileActiveMissingManagedPlugins(sender);
  if (
    typeof rawPluginId === "string" &&
    repair.removedPluginIds.includes(rawPluginId)
  ) {
    throw new Error(
      `Removed stale plugin entry "${rawPluginId}" because its managed source folder no longer exists`,
    );
  }
  const path = await managedPluginSourceRoot(rawPluginId, false);
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
  return { path };
}

async function installPluginFromFolder(
  sender: WebContents,
): Promise<{
  status: "installed" | "cancelled";
  pluginId?: string;
  sourceFolder?: string;
  warning?: { message: string };
}> {
  const previous = active;
  if (!previous || !liveController || !ipcHost) {
    throw new Error("plugin runtime is not active");
  }
  const picked = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(sender) ?? undefined,
    {
      title: "Install plugin from folder",
      properties: ["openDirectory"],
    },
  );
  const selected = picked.filePaths[0];
  if (picked.canceled || !selected) return { status: "cancelled" };

  const source = await fs.realpath(selected);
  const rawManifest = JSON.parse(
    await fs.readFile(join(source, "termco-plugin.json"), "utf8"),
  ) as unknown;
  const parsed = parsePluginManifestV3(rawManifest);
  if (!parsed.ok) throw new Error(`invalid plugin manifest: ${parsed.error}`);
  if (!parsed.manifest.entrypoints) {
    throw new Error("the selected folder is a contract package, not an executable plugin");
  }
  if (
    previous.profile.plugins.some((candidate) =>
      previous.manifests.get(candidate.id)?.id === parsed.manifest.id
    )
  ) {
    throw new Error(`plugin "${parsed.manifest.id}" is already in this profile`);
  }

  const paths = roots();
  await fs.mkdir(paths.userPluginsRoot, { recursive: true });
  const target = join(paths.userPluginsRoot, parsed.manifest.id);
  if (existsSync(target)) {
    throw new Error(`plugin folder already exists at ${target}`);
  }
  try {
    await fs.cp(source, target, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    const compiled = await compileLivePlugin({
      repositoryRoot: paths.repositoryRoot,
      pluginRoot: target,
      cacheRoot: paths.userCacheRoot,
    });
    let plugins: ProfilePluginRowV3[];
    if (compiled.manifest.replaces) {
      const replaced = previous.tree.plugins.find(
        (plugin) => plugin.manifest.id === compiled.manifest.replaces,
      );
      if (!replaced) {
        throw new Error(
          `replacement target "${compiled.manifest.replaces}" is not active`,
        );
      }
      plugins = replaceProfileRow(
        previous.profile.plugins,
        replaced.id,
        compiled.manifest.id,
        target,
      );
    } else {
      plugins = [
        ...previous.profile.plugins.map((candidate) => ({ ...candidate })),
        { id: compiled.manifest.id, module: target },
      ];
    }
    const profile: TermcoProfileV3 = {
      schemaVersion: 3,
      id: `termco.user.${Date.now()}.${randomUUID().slice(0, 8)}`,
      bundles: [],
      plugins,
      patches: [],
    };
    const result = await activateProfileLayer({ sender, paths, previous, profile });
    if (result.status === "cancelled") {
      await fs.rm(target, { recursive: true, force: true });
      return { status: "cancelled" };
    }
    return {
      status: "installed",
      pluginId: compiled.manifest.id,
      sourceFolder: target,
      ...(result.warning ? { warning: { message: result.warning.message } } : {}),
    };
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function applyPlugin(
  sender: WebContents,
  rawPluginId: unknown,
): Promise<ApplyPluginResult> {
  if (typeof rawPluginId !== "string") throw new Error("plugin id is invalid");
  const repair = await reconcileActiveMissingManagedPlugins(sender);
  if (repair.removedPluginIds.includes(rawPluginId)) {
    throw new Error(
      `Removed stale plugin entry "${rawPluginId}" because its managed source folder no longer exists; create a new draft to apply it again`,
    );
  }
  const previous = active;
  if (!previous) throw new Error("plugin runtime is not active");
  const paths = roots();
  const selected = previous.profile.plugins.some((candidate) => {
    const manifest = previous.manifests.get(candidate.id);
    return candidate.id === rawPluginId || manifest?.id === rawPluginId;
  });
  const selectedSource = selected
    ? selectedPluginSource(rawPluginId, true)
    : null;
  const folder = selectedSource
    ? sourceFolder(paths, selectedSource.source.location)
    : await managedPluginSourceRoot(rawPluginId, true);
  const draftManifest = selectedSource
    ? null
    : parsePluginManifestV3(JSON.parse(
        await fs.readFile(join(folder, "termco-plugin.json"), "utf8"),
      ));
  if (draftManifest && !draftManifest.ok) {
    throw new Error(`managed plugin draft manifest is invalid: ${draftManifest.error}`);
  }
  const sourceManifest = selectedSource?.manifest ?? draftManifest!.manifest;
  const sourceId = selectedSource?.id ?? sourceManifest.id;
  const nextVersion = nextPatchVersion(sourceManifest.version);
  const manifestFile = join(folder, "termco-plugin.json");
  const originalManifest = await fs.readFile(manifestFile, "utf8");
  const edited = JSON.parse(originalManifest) as TermcoPluginManifestV3;
  if (edited.id !== sourceManifest.id) {
    throw new Error(
      `edited manifest id "${edited.id}" does not match managed plugin "${sourceManifest.id}"`,
    );
  }
  if (
    edited.replaces !== undefined &&
    edited.replaces !== sourceManifest.replaces
  ) {
    throw new Error(
      "a replacement relationship cannot be added or changed through apply; use the explicit replace operation",
    );
  }
  const packageFile = join(folder, "package.json");
  let originalPackage: string | undefined;
  try {
    originalPackage = await fs.readFile(packageFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const restoreSourceMetadata = async () => {
    await fs.writeFile(manifestFile, originalManifest);
    if (originalPackage !== undefined) {
      await fs.writeFile(packageFile, originalPackage);
    }
  };

  try {
    edited.version = nextVersion;
    await writeJson(manifestFile, edited);
    if (originalPackage !== undefined) {
      const packageJson = JSON.parse(originalPackage) as Record<string, unknown>;
      packageJson.version = nextVersion;
      await writeJson(packageFile, packageJson);
    }

    const compiled = await compileLivePlugin({
      repositoryRoot: paths.repositoryRoot,
      pluginRoot: folder,
      cacheRoot: paths.userCacheRoot,
    });
    const profileId = `termco.user.${Date.now()}.${randomUUID().slice(0, 8)}`;
    let plugins: ProfilePluginRowV3[];
    if (!selectedSource) {
      if (compiled.manifest.replaces) {
        const replaced = previous.tree.plugins.find(
          (plugin) => plugin.manifest.id === compiled.manifest.replaces,
        );
        if (!replaced) {
          throw new Error(
            `replacement target "${compiled.manifest.replaces}" is not active`,
          );
        }
        plugins = replaceProfileRow(
          previous.profile.plugins,
          replaced.id,
          compiled.manifest.id,
          folder,
        );
      } else {
        plugins = [
          ...previous.profile.plugins.map((row) => ({ ...row })),
          { id: compiled.manifest.id, module: folder },
        ];
      }
    } else {
      plugins = replaceProfileRow(
        previous.profile.plugins,
        sourceId,
        sourceId,
        folder,
      );
    }
    if (selectedSource?.manifest.replaces && !edited.replaces) {
      plugins = releaseReplacementProfileRows(
        plugins,
        sourceId,
        selectedSource.manifest.replaces,
      );
    }
    const profile: TermcoProfileV3 = {
      schemaVersion: 3,
      id: profileId,
      bundles: [],
      plugins,
      patches: [],
    };
    const result = await activateProfileLayer({ sender, paths, previous, profile });
    if (result.status === "cancelled") await restoreSourceMetadata();
    const completionId = result.status === "replaced" ? randomUUID() : null;
    if (result.status === "replaced" && completionId) {
      pluginCompletions.set(completionId, {
        completionId,
        pluginId: compiled.manifest.id,
        generation: compiled.integrity,
        appliedProfileId: profile.id,
        previousProfile: snapshotProfile(previous.profile),
      });
      await persistPluginCompletions(paths);
    }
    return {
      status: result.status,
      pluginId: compiled.manifest.id,
      sourceFolder: folder,
      generation: result.status === "replaced" ? compiled.integrity : null,
      completionId,
      ...(result.warning ? { warning: result.warning } : {}),
    };
  } catch (error) {
    try {
      await restoreSourceMetadata();
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `plugin apply failed and source metadata could not be restored: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    throw error;
  }
}

async function undoPluginCompletion(
  sender: WebContents,
  rawCompletionId: unknown,
): Promise<PluginUndoResult> {
  if (typeof rawCompletionId !== "string") {
    throw new Error("plugin completion id is invalid");
  }
  const completion = pluginCompletions.get(rawCompletionId);
  if (!completion) {
    throw new Error(`plugin completion "${rawCompletionId}" was not found`);
  }
  const previous = active;
  if (!previous) throw new Error("plugin runtime is not active");
  if (previous.profile.id !== completion.appliedProfileId) {
    throw new Error(
      `plugin completion "${rawCompletionId}" is stale because the active profile changed`,
    );
  }
  const profile: TermcoProfileV3 = {
    ...structuredClone(completion.previousProfile),
    id: `termco.user.${Date.now()}.${randomUUID().slice(0, 8)}`,
  };
  const result = await activateProfileLayer({
    sender,
    paths: roots(),
    previous,
    profile,
  });
  if (result.status === "replaced") {
    pluginCompletions.delete(rawCompletionId);
    await persistPluginCompletions(roots());
  }
  return {
    status: result.status,
    completionId: rawCompletionId,
    pluginId: completion.pluginId,
    ...(result.warning ? { warning: { message: result.warning.message } } : {}),
  };
}

async function uninstallPlugin(
  sender: WebContents,
  rawPluginId: unknown,
): Promise<UninstallPluginResult> {
  const repair = await reconcileActiveMissingManagedPlugins(sender);
  if (
    typeof rawPluginId === "string" &&
    repair.removedPluginIds.includes(rawPluginId)
  ) {
    return {
      status: "uninstalled",
      pluginId: rawPluginId,
      sourceFolder: join(roots().userPluginsRoot, rawPluginId),
      movedToTrash: false,
      warning: {
        message:
          "Removed the stale profile entry. Its managed source folder was already missing.",
      },
    };
  }
  const previous = active;
  if (!previous || !liveController || !ipcHost) {
    throw new Error("plugin runtime is not active");
  }
  const source = selectedPluginSource(rawPluginId, true);
  if (source.source.type !== "local" || source.source.mutable !== true) {
    throw new Error(`plugin "${source.manifest.id}" is not a user-installed plugin`);
  }

  const paths = roots();
  const managedRoot = await fs.realpath(paths.userPluginsRoot);
  const folder = await fs.realpath(sourceFolder(paths, source.source.location));
  const managedRelative = relative(managedRoot, folder);
  if (
    managedRelative !== source.manifest.id ||
    managedRelative.startsWith("..") ||
    isAbsolute(managedRelative)
  ) {
    throw new Error(
      `plugin "${source.manifest.id}" is outside Termco's managed plugin folder`,
    );
  }

  const autoConfirm =
    process.env.TERMCO_E2E === "1" &&
    process.env.TERMCO_E2E_AUTO_CONFIRM_UNINSTALL === "1";
  const confirmed = autoConfirm ||
    (await dialog.showMessageBox(
      BrowserWindow.fromWebContents(sender) ?? undefined,
      {
        type: "warning",
        title: `Uninstall ${source.manifest.name}?`,
        message: `Uninstall “${source.manifest.name}” and restore the inherited plugin?`,
        detail:
          "The plugin will be deactivated first. Its complete source folder will then be moved to Trash, where it can still be recovered.",
        buttons: ["Cancel", "Uninstall and move to Trash"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      },
    )).response === 1;
  if (!confirmed) {
    return {
      status: "cancelled",
      pluginId: source.manifest.id,
      sourceFolder: folder,
      movedToTrash: false,
    };
  }

  const profile: TermcoProfileV3 = {
    schemaVersion: 3,
    id: `termco.user.${Date.now()}.${randomUUID().slice(0, 8)}`,
    bundles: [],
    plugins: profileRowsAfterUninstall(previous.profile.plugins, {
      id: source.id,
      ...(source.manifest.replaces
        ? { replaces: source.manifest.replaces }
        : {}),
    }),
    patches: [],
  };
  const result = await activateProfileLayer({ sender, paths, previous, profile });
  if (result.status === "cancelled") {
    return {
      status: "cancelled",
      pluginId: source.manifest.id,
      sourceFolder: folder,
      movedToTrash: false,
      ...(result.warning ? { warning: { message: result.warning.message } } : {}),
    };
  }

  try {
    await shell.trashItem(folder);
    return {
      status: "uninstalled",
      pluginId: source.manifest.id,
      sourceFolder: folder,
      movedToTrash: true,
    };
  } catch (error) {
    return {
      status: "uninstalled",
      pluginId: source.manifest.id,
      sourceFolder: folder,
      movedToTrash: false,
      warning: {
        message: `Plugin was deactivated, but its source folder could not be moved to Trash: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
    };
  }
}

export function pluginRuntime(): PreparedProfileProcess {
  if (!active) throw new Error("plugin runtime is not active");
  return active;
}

export async function disposePluginRuntime(): Promise<void> {
  ipcMain.removeHandler(PLAN_PLUGIN_CHANNEL);
  ipcMain.removeHandler(CREATE_PLUGIN_CHANNEL);
  ipcMain.removeHandler(FORK_PLUGIN_CHANNEL);
  ipcMain.removeHandler(COPY_REPLACE_CHANNEL);
  ipcMain.removeHandler(APPLY_PLUGIN_CHANNEL);
  ipcMain.removeHandler(UNDO_PLUGIN_CHANNEL);
  ipcMain.removeHandler(UNINSTALL_PLUGIN_CHANNEL);
  ipcMain.removeHandler(SET_PLUGIN_ENABLED_CHANNEL);
  ipcMain.removeHandler(PREVIEW_SET_PLUGIN_ENABLED_CHANNEL);
  ipcMain.removeHandler(INSTALL_PLUGIN_FROM_FOLDER_CHANNEL);
  ipcMain.removeHandler(OPEN_PLUGINS_FOLDER_CHANNEL);
  ipcMain.removeHandler(OPEN_PLUGIN_FOLDER_CHANNEL);
  ipcMain.removeHandler(ACTIVATE_PROFILE_CHANNEL);
  ipcMain.removeHandler(PROFILE_SNAPSHOT_CHANNEL);
  ipcMain.removeHandler(EXPORT_PROFILE_CHANNEL);
  ipcMain.removeHandler(IMPORT_PROFILE_CHANNEL);
  ipcMain.removeHandler(RECOVER_RENDERER_PROFILE_CHANNEL);
  ipcMain.removeHandler(LIST_PLUGIN_DRAFTS_CHANNEL);
  ipcMain.removeHandler(LIST_SOURCE_FILES_CHANNEL);
  ipcMain.removeHandler(READ_SOURCE_FILE_CHANNEL);
  ipcMain.removeHandler(WRITE_SOURCE_FILE_CHANNEL);
  ipcMain.removeHandler(CHECK_PLUGIN_RELEASES_CHANNEL);
  ipcMain.removeHandler(INSTALL_PLUGIN_RELEASE_CHANNEL);
  ipcHost?.dispose();
  ipcHost = null;
  liveController = null;
  pluginReleaseManager = null;
  pluginReleaseSender = null;
  const current = active;
  active = null;
  pluginCompletions.clear();
  pluginAuthoringPlans.clear();
  await current?.runtime.disposeAll();
}

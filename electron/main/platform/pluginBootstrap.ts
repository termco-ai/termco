import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type {
  TermcoPluginManifestV3,
  TermcoProfileV3,
} from "../../../src/platform/contracts";
import { parseProfileV3 } from "../../../src/platform/profile";
import type {
  PluginBootstrapProgress,
  PluginBootstrapResult,
  PluginBootstrapStatus,
} from "../../../src/platform/pluginBootstrap";
import {
  downloadPluginReleaseArchive,
  extractPluginReleaseArchive,
  fetchLatestPluginRelease,
  installCompiledPluginGeneration,
  loadPluginReleaseConfiguration,
  type PluginReleaseConfiguration,
} from "./pluginReleaseManager";
import { isProtectedPlugin } from "./pluginRelease";

export interface PluginBootstrapPaths {
  repositoryRoot: string;
  profileTemplatesRoot: string;
  userProfilesRoot: string;
  activeProfileFile: string;
  completionFile: string;
  stagingRoot: string;
  officialPluginsRoot: string;
  cacheRoot: string;
  stateFile: string;
  configurationFile: string;
}

export interface PluginBootstrapDependencies {
  applicationVersion: string;
  paths: PluginBootstrapPaths;
  compile(pluginRoot: string, cacheRoot: string): Promise<{
    manifest: TermcoPluginManifestV3;
    integrity: string;
  }>;
  fetch?: typeof fetch;
  configuration?: PluginReleaseConfiguration;
  onProgress?(progress: PluginBootstrapProgress): void;
}

const DEFAULT_PROFILE_ID = "termco.default";
const SAFE_PROFILE_ID = "termco.safe-recovery";

function profileFolder(profileId: string): string {
  if (profileId === DEFAULT_PROFILE_ID) return "default";
  if (profileId === SAFE_PROFILE_ID) return "safe-recovery";
  return profileId;
}

async function readProfile(root: string, id: string): Promise<TermcoProfileV3> {
  const value = JSON.parse(
    await fs.readFile(join(root, id.replace("termco.", ""), "profile.json"), "utf8"),
  ) as unknown;
  const parsed = parseProfileV3(value);
  if (!parsed.ok || parsed.profile.id !== id) {
    throw new Error(`plugin profile template "${id}" is invalid`);
  }
  return parsed.profile;
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

export function assertCompleteInitialPluginRelease(
  profile: TermcoProfileV3,
  releasedPluginIds: readonly string[],
): void {
  const expected = profile.plugins
    .filter((row) => !isProtectedPlugin(row.id))
    .map((row) => row.id)
    .sort();
  const received = [...new Set(releasedPluginIds)].sort();
  const missing = expected.filter((id) => !received.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `initial plugin release is not a complete application profile` +
        `; missing: ${missing.join(", ")}`,
    );
  }
}

export function provisionedProfile(
  template: TermcoProfileV3,
  sourceById: ReadonlyMap<string, string>,
  appendMissing = false,
): TermcoProfileV3 {
  const existing = new Set(template.plugins.map((row) => row.id));
  return {
    ...structuredClone(template),
    plugins: [
      ...template.plugins.map((row) => {
        const source = sourceById.get(row.id);
        return source ? { ...row, module: `official:${source}` } : { ...row };
      }),
      ...(appendMissing
        ? [...sourceById]
            .filter(([id]) => !existing.has(id))
            .map(([id, source]) => ({ id, module: `official:${source}` }))
        : []),
    ],
  };
}

export async function pluginBootstrapStatus(input: {
  applicationVersion: string;
  paths: PluginBootstrapPaths;
  repository: string;
}): Promise<PluginBootstrapStatus> {
  let completed = false;
  try {
    try {
      const marker = JSON.parse(
        await fs.readFile(input.paths.completionFile, "utf8"),
      ) as { schemaVersion?: unknown; completed?: unknown };
      completed = marker.schemaVersion === 1 && marker.completed === true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return {
          kind: "recovery",
          message: `The initial setup record is invalid: ${String(error)}`,
        };
      }
    }
    const [active, state] = await Promise.all([
      fs.readFile(input.paths.activeProfileFile, "utf8"),
      fs.readFile(input.paths.stateFile, "utf8"),
    ]);
    const activeValue = JSON.parse(active) as { profileId?: unknown };
    const stateValue = JSON.parse(state) as { activeReleaseId?: unknown };
    if (
      typeof activeValue.profileId === "string" &&
      activeValue.profileId.length > 0 &&
      typeof stateValue.activeReleaseId === "string" &&
      stateValue.activeReleaseId.length > 0
    ) {
      await Promise.all([
        fs.access(
          join(
            input.paths.userProfilesRoot,
            profileFolder(activeValue.profileId),
            "profile.json",
          ),
        ),
        fs.access(
          join(
            input.paths.officialPluginsRoot,
            stateValue.activeReleaseId,
            "plugins",
          ),
        ),
      ]);
      if (!completed) {
        await writeJsonAtomic(input.paths.completionFile, {
          schemaVersion: 1,
          completed: true,
          completedAt: new Date().toISOString(),
          baselineReleaseId: stateValue.activeReleaseId,
        });
      }
      return { kind: "ready" };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[plugins] initial setup state is incomplete: ${String(error)}`);
    }
    if (completed) {
      return {
        kind: "recovery",
        message:
          "The initial setup completed previously, but its active plugin files are incomplete. Use recovery instead of running setup again.",
      };
    }
  }
  return {
    kind: "required",
    repository: input.repository,
    applicationVersion: input.applicationVersion,
  };
}

async function directoryIntegrity(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string): Promise<void> => {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error(`plugin release source contains a symbolic link: ${entry.name}`);
      }
      const path = join(directory, entry.name);
      const relativePath = path.slice(root.length + 1).replaceAll("\\", "/");
      hash.update(entry.isDirectory() ? `d:${relativePath}\0` : `f:${relativePath}\0`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) hash.update(await fs.readFile(path));
    }
  };
  await visit(root);
  return hash.digest("hex");
}

export async function installInitialPluginRelease(
  input: PluginBootstrapDependencies,
): Promise<PluginBootstrapResult> {
  const progress = (
    stage: PluginBootstrapProgress["stage"],
    completed: number,
    total: number,
    pluginName?: string,
  ) => input.onProgress?.({ stage, completed, total, ...(pluginName ? { pluginName } : {}) });
  const configuration = input.configuration ??
    await loadPluginReleaseConfiguration(input.paths.configurationFile);

  progress("connecting", 0, 1);
  const release = await fetchLatestPluginRelease({
    configuration,
    currentApplicationVersion: input.applicationVersion,
    fetch: input.fetch,
  });
  if (!release.compatible) {
    throw new Error(
      `plugin release ${release.manifest.releaseId} is not compatible with Termco ${input.applicationVersion}`,
    );
  }

  const [defaultTemplate, safeTemplate] = await Promise.all([
    readProfile(input.paths.profileTemplatesRoot, DEFAULT_PROFILE_ID),
    readProfile(input.paths.profileTemplatesRoot, SAFE_PROFILE_ID),
  ]);
  assertCompleteInitialPluginRelease(
    defaultTemplate,
    release.manifest.plugins.map(({ id }) => id),
  );

  progress("verifying", 0, 1);
  const archive = await downloadPluginReleaseArchive({
    configuration,
    release,
    fetch: input.fetch,
  });
  progress("downloading", 1, 1);

  await fs.mkdir(input.paths.stagingRoot, { recursive: true });
  const staging = await fs.mkdtemp(join(input.paths.stagingRoot, "initial-"));
  const extracted = join(staging, "source");
  const stagedCache = join(staging, "cache");
  const finalReleaseRoot = join(
    input.paths.officialPluginsRoot,
    release.manifest.releaseId,
  );
  let sourceCommitted = false;
  try {
    await extractPluginReleaseArchive(archive, extracted);
    const sourceRoot = join(extracted, "plugins");
    const archiveIds = (await fs.readdir(sourceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
    const expectedIds = release.manifest.plugins.map(({ id }) => id).sort();
    if (
      archiveIds.length !== expectedIds.length ||
      archiveIds.some((id, index) => id !== expectedIds[index])
    ) {
      throw new Error("plugin release archive contents do not match its signed manifest");
    }

    const compiled = new Map<string, { integrity: string }>();
    for (const [index, item] of release.manifest.plugins.entries()) {
      progress("preparing", index, release.manifest.plugins.length, item.name);
      const result = await input.compile(join(sourceRoot, item.id), stagedCache);
      if (
        result.manifest.id !== item.id ||
        result.manifest.version !== item.version
      ) {
        throw new Error(`compiled plugin "${item.id}" changed signed identity`);
      }
      compiled.set(item.id, result);
    }

    let releaseSourceExists = false;
    try {
      await fs.lstat(finalReleaseRoot);
      releaseSourceExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (releaseSourceExists) {
      const [existingIntegrity, downloadedIntegrity] = await Promise.all([
        directoryIntegrity(finalReleaseRoot),
        directoryIntegrity(extracted),
      ]);
      if (existingIntegrity !== downloadedIntegrity) {
        throw new Error(
          `plugin release source at ${finalReleaseRoot} does not match the signed release`,
        );
      }
    } else {
      await fs.mkdir(input.paths.officialPluginsRoot, { recursive: true });
      await fs.rename(extracted, finalReleaseRoot);
      sourceCommitted = true;
    }

    for (const item of release.manifest.plugins) {
      const stagedGeneration = join(stagedCache, item.id, item.version);
      const finalGeneration = join(input.paths.cacheRoot, item.id, item.version);
      await installCompiledPluginGeneration(stagedGeneration, finalGeneration);
      const installedIntegrity = (
        await fs.readFile(join(finalGeneration, "integrity.txt"), "utf8")
      ).trim();
      if (installedIntegrity !== compiled.get(item.id)?.integrity) {
        throw new Error(`compiled plugin "${item.id}" failed its integrity check`);
      }
    }

    progress("activating", 0, 1);
    const sourceById = new Map(
      release.manifest.plugins.map((item) => [
        item.id,
        join(finalReleaseRoot, "plugins", item.id),
      ]),
    );
    const defaultProfile = provisionedProfile(defaultTemplate, sourceById, true);
    const safeProfile = provisionedProfile(safeTemplate, sourceById);
    await Promise.all([
      writeJsonAtomic(
        join(input.paths.userProfilesRoot, "default", "profile.json"),
        defaultProfile,
      ),
      writeJsonAtomic(
        join(input.paths.userProfilesRoot, "safe-recovery", "profile.json"),
        safeProfile,
      ),
    ]);
    await writeJsonAtomic(input.paths.activeProfileFile, {
      profileId: DEFAULT_PROFILE_ID,
    });
    await writeJsonAtomic(input.paths.stateFile, {
      schemaVersion: 1,
      activeReleaseId: release.manifest.releaseId,
      history: [],
    });
    await writeJsonAtomic(input.paths.completionFile, {
      schemaVersion: 1,
      completed: true,
      completedAt: new Date().toISOString(),
      baselineReleaseId: release.manifest.releaseId,
    });
    progress("activating", 1, 1);
    return {
      status: "installed",
      releaseId: release.manifest.releaseId,
      pluginCount: release.manifest.plugins.length,
    };
  } catch (error) {
    if (sourceCommitted) {
      await fs.rm(finalReleaseRoot, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

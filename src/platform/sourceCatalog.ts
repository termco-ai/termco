import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type {
  ProfilePluginRowV3,
  TermcoPluginManifestV3,
  TermcoProfileV3,
} from "./contracts";
import { parsePluginManifestV3 } from "./manifest";
import { parseProfileV3 } from "./profile";
import { describePluginSource } from "./sourceDescriptor";

export { describePluginSource } from "./sourceDescriptor";

const ignoredPackageSearchDirectories = new Set([
  ".git",
  ".turbo",
  ".vite",
  "dist",
  "node_modules",
  "out",
]);

async function packageRootFromEntry(entry: string): Promise<string> {
  let current = dirname(entry);
  while (true) {
    try {
      await fs.access(join(current, "package.json"));
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return dirname(entry);
    current = parent;
  }
}

async function findWorkspacePackage(
  root: string,
  packageName: string,
): Promise<string | undefined> {
  const visit = async (directory: string): Promise<string | undefined> => {
    try {
      const value = JSON.parse(
        await fs.readFile(join(directory, "package.json"), "utf8"),
      ) as { name?: unknown };
      if (value.name === packageName) return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        !entry.isDirectory() ||
        ignoredPackageSearchDirectories.has(entry.name)
      ) {
        continue;
      }
      const found = await visit(join(directory, entry.name));
      if (found) return found;
    }
    return undefined;
  };
  return visit(root);
}

async function resolvePluginRoot(
  repositoryRoot: string,
  row: ProfilePluginRowV3,
): Promise<string> {
  const source = describePluginSource(row.module);
  if (source.type === "file") return source.location;
  if (source.type === "bundled" || source.type === "local") {
    return resolve(repositoryRoot, source.location);
  }
  const requireFromRepository = createRequire(
    join(repositoryRoot, "package.json"),
  );
  try {
    return await packageRootFromEntry(
      requireFromRepository.resolve(row.module),
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code !== "MODULE_NOT_FOUND" &&
      code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    ) {
      throw error;
    }
  }
  const workspacePackage = await findWorkspacePackage(
    repositoryRoot,
    row.module,
  );
  if (workspacePackage) return workspacePackage;
  throw new Error(
    `cannot resolve plugin module "${row.module}" for row "${row.id}"`,
  );
}

export async function loadProfileDirectory(
  profilesRoot: string,
): Promise<Map<string, TermcoProfileV3>> {
  const entries = await fs.readdir(profilesRoot, { withFileTypes: true });
  const profiles = new Map<string, TermcoProfileV3>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = join(profilesRoot, entry.name, "profile.json");
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`cannot read profile ${entry.name}: ${String(error)}`);
    }
    const parsed = parseProfileV3(raw);
    if (!parsed.ok)
      throw new Error(`invalid profile ${entry.name}: ${parsed.error}`);
    if (profiles.has(parsed.profile.id)) {
      throw new Error(`duplicate profile id "${parsed.profile.id}"`);
    }
    profiles.set(parsed.profile.id, parsed.profile);
  }
  return profiles;
}

/** Load profile layers from several roots. Identical ids are rejected: a
 * company or user profile must extend a base instead of silently shadowing it. */
export async function loadProfileDirectories(
  profilesRoots: readonly string[],
): Promise<Map<string, TermcoProfileV3>> {
  const profiles = new Map<string, TermcoProfileV3>();
  for (const root of profilesRoots) {
    let loaded: Map<string, TermcoProfileV3>;
    try {
      loaded = await loadProfileDirectory(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const [id, profile] of loaded) {
      if (profiles.has(id)) {
        throw new Error(`duplicate profile id "${id}" across profile roots`);
      }
      profiles.set(id, profile);
    }
  }
  return profiles;
}

export async function loadProfileManifests(
  repositoryRoot: string,
  profile: TermcoProfileV3,
): Promise<Map<string, TermcoPluginManifestV3>> {
  const manifests = new Map<string, TermcoPluginManifestV3>();
  for (const row of profile.plugins) {
    const pluginRoot = await resolvePluginRoot(repositoryRoot, row);
    let raw: unknown;
    try {
      raw = JSON.parse(
        await fs.readFile(join(pluginRoot, "termco-plugin.json"), "utf8"),
      );
    } catch (error) {
      throw new Error(`cannot read plugin "${row.id}": ${String(error)}`);
    }
    const parsed = parsePluginManifestV3(raw);
    if (!parsed.ok) {
      throw new Error(`invalid plugin "${row.id}": ${parsed.error}`);
    }
    manifests.set(row.id, parsed.manifest);
  }
  return manifests;
}

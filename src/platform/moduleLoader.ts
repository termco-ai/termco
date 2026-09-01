import { promises as fs, type Dirent } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedPlugin, ResolvedPluginTree } from "./contracts";
import type { RuntimeProcess } from "./processGraph";
import type { PluginModule } from "./runtime";

export interface CompiledPluginLocation {
  pluginId: string;
  version: string;
  root: string;
  entry: string;
  integrity: string;
}

export type PluginCacheRoots = string | readonly string[];

const RUNTIME_PROCESSES: readonly RuntimeProcess[] = [
  "main",
  "renderer",
  "utility",
];

const repairedNativeRuntimeRoots = new Set<string>();

async function repairNodePtySpawnHelpers(root: string): Promise<void> {
  if (process.platform === "win32" || repairedNativeRuntimeRoots.has(root)) {
    return;
  }
  const nodePtyRoot = join(root, "node_modules", "node-pty");
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name === "spawn-helper") {
        const stats = await fs.stat(path);
        if ((stats.mode & 0o111) === 0) {
          await fs.chmod(path, stats.mode | 0o111);
        }
      }
    }));
  };
  await visit(nodePtyRoot);
  repairedNativeRuntimeRoots.add(root);
}

function cacheRoots(value: PluginCacheRoots): readonly string[] {
  return typeof value === "string" ? [value] : value;
}

function entrypointName(
  process: RuntimeProcess,
): "renderer" | "main" | "utility" {
  return process;
}

export async function locateCompiledPlugin(
  plugin: ResolvedPlugin,
  process: RuntimeProcess,
  cacheRoot: PluginCacheRoots,
): Promise<CompiledPluginLocation> {
  const entrypoint = plugin.manifest.entrypoints?.[entrypointName(process)];
  if (!entrypoint) {
    throw new Error(`plugin row "${plugin.id}" has no ${process} entrypoint`);
  }
  for (const candidate of cacheRoots(cacheRoot)) {
    const root = join(candidate, plugin.id, plugin.manifest.version);
    let actualIntegrity: string;
    try {
      actualIntegrity = (
        await fs.readFile(join(root, "integrity.txt"), "utf8")
      ).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (
      plugin.source.integrity &&
      actualIntegrity !== plugin.source.integrity
    ) {
      continue;
    }
    try {
      await fs.access(join(root, `${process}.mjs`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    // The compiled artifact is the code generation that will actually execute.
    // Resolve it onto the shared tree row before activation so every process,
    // activation context, contribution registry, and completion record speaks
    // about the same immutable generation. A pre-pinned source still has to
    // match above; an unpinned local/profile row becomes pinned here.
    plugin.source.integrity = actualIntegrity;
    await repairNodePtySpawnHelpers(root);
    return {
      pluginId: plugin.id,
      version: plugin.manifest.version,
      root,
      entry: join(root, `${process}.mjs`),
      integrity: actualIntegrity,
    };
  }
  throw new Error(
    plugin.source.integrity
      ? `plugin row "${plugin.id}" compiled cache does not match source integrity ${plugin.source.integrity}`
      : `compiled cache for plugin row "${plugin.id}" was not found`,
  );
}

/** Resolve every executable row to the exact compiled generation before two
 * trees are compared for live replacement. This reads cache metadata only; it
 * neither imports nor activates plugin code. */
export async function qualifyCompiledPluginGenerations(
  tree: ResolvedPluginTree,
  cacheRoot: PluginCacheRoots,
): Promise<void> {
  await Promise.all(
    tree.plugins.map(async (plugin) => {
      const process = RUNTIME_PROCESSES.find(
        (candidate) => plugin.manifest.entrypoints?.[candidate] !== undefined,
      );
      if (!process) return;
      await locateCompiledPlugin(plugin, process, cacheRoot);
    }),
  );
}

export async function importCompiledPlugin(
  location: CompiledPluginLocation,
): Promise<PluginModule> {
  const url = pathToFileURL(location.entry);
  url.searchParams.set("integrity", location.integrity);
  const imported = (await import(url.href)) as { default?: PluginModule };
  if (!imported.default || typeof imported.default.activate !== "function") {
    throw new Error(
      `compiled plugin "${location.pluginId}" must default-export activate()`,
    );
  }
  return imported.default;
}

export function createCompiledModuleLoader(input: {
  tree: ResolvedPluginTree;
  process: RuntimeProcess;
  cacheRoot: PluginCacheRoots;
}): (pluginId: string) => Promise<PluginModule> {
  const byId = new Map(input.tree.plugins.map((plugin) => [plugin.id, plugin]));
  return async (pluginId) => {
    const plugin = byId.get(pluginId);
    if (!plugin)
      throw new Error(`plugin row "${pluginId}" is not in the resolved tree`);
    return importCompiledPlugin(
      await locateCompiledPlugin(plugin, input.process, input.cacheRoot),
    );
  };
}

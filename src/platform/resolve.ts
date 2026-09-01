import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ResolvedPlugin,
  ResolvedPluginSource,
  ResolvedPluginTree,
  TermcoPluginManifestV3,
  TermcoProfileV3,
} from "./contracts";

export interface ResolvePluginTreeInput {
  profile: TermcoProfileV3;
  manifests: ReadonlyMap<string, TermcoPluginManifestV3>;
}

export class PluginTreeResolutionError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("\n"));
    this.name = "PluginTreeResolutionError";
  }
}

function sourceFor(module: string): ResolvedPluginSource {
  if (module.startsWith("bundled:")) {
    return {
      type: "bundled",
      module,
      location: module.slice("bundled:".length),
    };
  }
  if (module.startsWith("file:")) {
    return { type: "file", module, location: fileURLToPath(module) };
  }
  if (
    isAbsolute(module) ||
    module.startsWith("./") ||
    module.startsWith("../")
  ) {
    return { type: "local", module, location: module, mutable: true };
  }
  return { type: "package", module, location: module };
}

/** Resolve the effective profile rows in source order. Executable modules own
 * service dependency settlement, so this stage has no service catalogue and
 * performs no dependency sort. */
export function resolvePluginTree(
  input: ResolvePluginTreeInput,
): ResolvedPluginTree {
  const issues: string[] = [];
  const plugins: ResolvedPlugin[] = [];
  const rowIds = new Set<string>();

  for (const row of input.profile.plugins) {
    if (row.enabled === false) continue;
    if (rowIds.has(row.id)) {
      issues.push(`effective profile contains duplicate row "${row.id}"`);
      continue;
    }
    rowIds.add(row.id);
    const manifest = input.manifests.get(row.id);
    if (!manifest) {
      issues.push(`profile row "${row.id}" has no discovered plugin manifest`);
      continue;
    }
    if (!manifest.entrypoints) continue;
    plugins.push({ id: row.id, manifest, source: sourceFor(row.module) });
  }

  if (issues.length > 0) throw new PluginTreeResolutionError(issues);
  return {
    profileId: input.profile.id,
    plugins,
    activationOrder: plugins.map((plugin) => plugin.id),
  };
}

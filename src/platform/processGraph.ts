import type { PluginEntrypoints, ResolvedPluginTree } from "./contracts";

export type RuntimeProcess = keyof PluginEntrypoints;

/** Project only rows that own an entrypoint for this process. Runtime service
 * edges are deliberately not projected from manifest metadata. */
export function projectPluginTree(
  tree: ResolvedPluginTree,
  process: RuntimeProcess,
): ResolvedPluginTree {
  const plugins = tree.plugins.filter(
    (plugin) => plugin.manifest.entrypoints?.[process] !== undefined,
  );
  const ids = new Set(plugins.map((plugin) => plugin.id));
  return {
    profileId: tree.profileId,
    plugins,
    activationOrder: tree.activationOrder.filter((id) => ids.has(id)),
  };
}

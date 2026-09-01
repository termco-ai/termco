import {
  type ComposedProfile,
  composeProfile,
  type ProfileBundleV3,
} from "./composeProfile";
import type { ResolvedPluginTree, TermcoPluginManifestV3 } from "./contracts";
import {
  createCompiledModuleLoader,
  type PluginCacheRoots,
} from "./moduleLoader";
import { projectPluginTree, type RuntimeProcess } from "./processGraph";
import { resolvePluginTree } from "./resolve";
import { CapabilityRuntime } from "./runtime";
import {
  loadProfileDirectories,
  loadProfileDirectory,
  loadProfileManifests,
} from "./sourceCatalog";

export interface PreparedProfileProcess {
  profile: ComposedProfile;
  manifests: ReadonlyMap<string, TermcoPluginManifestV3>;
  tree: ResolvedPluginTree;
  processTree: ResolvedPluginTree;
  runtime: CapabilityRuntime;
  loadModule: ReturnType<typeof createCompiledModuleLoader>;
  activate(): Promise<void>;
}

/** Discover and resolve source rows before importing code. Calling activate is
 * the first point at which executable plugin modules run. */
export async function prepareProfileProcess(input: {
  repositoryRoot: string;
  profilesRoot: string | readonly string[];
  activeProfileId: string;
  cacheRoot: PluginCacheRoots;
  process: RuntimeProcess;
  bundles?: ReadonlyMap<string, ProfileBundleV3>;
}): Promise<PreparedProfileProcess> {
  const profiles = Array.isArray(input.profilesRoot)
    ? await loadProfileDirectories(input.profilesRoot)
    : await loadProfileDirectory(input.profilesRoot as string);
  const profile = composeProfile(
    input.activeProfileId,
    profiles,
    input.bundles ?? new Map(),
  );
  const manifests = await loadProfileManifests(input.repositoryRoot, profile);
  const tree = resolvePluginTree({ profile, manifests });
  const processTree = projectPluginTree(tree, input.process);
  const runtime = new CapabilityRuntime(processTree);
  const load = createCompiledModuleLoader({
    tree,
    process: input.process,
    cacheRoot: input.cacheRoot,
  });
  return {
    profile,
    manifests,
    tree,
    processTree,
    runtime,
    loadModule: load,
    activate: () => runtime.activateGraph(load),
  };
}

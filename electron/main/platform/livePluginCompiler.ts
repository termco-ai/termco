import { app } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { packagedEsbuildBinary } from "../../../scripts/packaged-esbuild-binary.mjs";

interface DiscoveredPluginSource {
  root: string;
  manifest: import("../../../src/platform/contracts").TermcoPluginManifestV3;
  manifestPath: string;
}

interface CompileResult {
  pluginId: string;
  outputRoot: string;
  outputs: Record<string, string>;
  integrity: string;
}

interface CompilerModule {
  discoverPluginSource(pluginRoot: string): Promise<DiscoveredPluginSource>;
  compilePlugin(
    plugin: DiscoveredPluginSource,
    cacheRoot: string,
    options?: { dependencyRoot?: string },
  ): Promise<CompileResult>;
}

let compiler: Promise<CompilerModule> | null = null;

function compilerFile(repositoryRoot: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, "platform", "plugin-compiler-lib.mjs")
    : join(repositoryRoot, "scripts", "plugin-compiler-lib.mjs");
}

async function loadCompiler(repositoryRoot: string): Promise<CompilerModule> {
  if (app.isPackaged) {
    process.env.ESBUILD_BINARY_PATH = packagedEsbuildBinary(process.resourcesPath);
  }
  compiler ??= import(pathToFileURL(compilerFile(repositoryRoot)).href) as Promise<CompilerModule>;
  return compiler;
}

/** Compile one copied source folder into the user's disposable cache. */
export async function compileLivePlugin(input: {
  repositoryRoot: string;
  pluginRoot: string;
  cacheRoot: string;
}): Promise<{ manifest: DiscoveredPluginSource["manifest"]; integrity: string }> {
  const module = await loadCompiler(input.repositoryRoot);
  const source = await module.discoverPluginSource(input.pluginRoot);
  const dependencyRoot = app.isPackaged
    ? join(app.getAppPath(), "node_modules")
    : join(input.repositoryRoot, "node_modules");
  const result = await module.compilePlugin(source, input.cacheRoot, {
    dependencyRoot,
  });
  return { manifest: source.manifest, integrity: result.integrity };
}

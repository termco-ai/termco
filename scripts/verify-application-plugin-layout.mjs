import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { packagedEsbuildBinary } from "./packaged-esbuild-binary.mjs";

const releaseRoot = resolve(process.argv[2] ?? "release");
const expectedCorePlugins = [
  "boot-diagnostics-native",
  "plugin-manager-native",
  "safe-recovery-native",
  "settings-native",
  "ui-shell-native",
  "updater-native",
  "workspace-shell-native",
];

async function directories(root) {
  return (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function findPluginPlatforms(root) {
  const matches = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      if (entry.name === "plugin-platform") matches.push(path);
      else await walk(path);
    }
  }
  await walk(root);
  return matches;
}

async function assertNoAgentFiles(root) {
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === "AGENTS.md") {
        throw new Error(`packaged agent instruction file: ${path}`);
      }
    }
  }
  await walk(root);
}

async function verifyPackagedCompiler(pluginPlatform) {
  const resources = dirname(pluginPlatform);
  const compilerRoot = join(resources, "platform");
  const compilerFile = join(compilerRoot, "plugin-compiler-lib.mjs");
  const esbuildRoot = join(compilerRoot, "node_modules", "esbuild");
  const packagedRequire = createRequire(compilerFile);
  for (const dependency of ["esbuild", "typescript"]) {
    const resolvedDependency = await fs.realpath(packagedRequire.resolve(dependency));
    const resolvedCompilerRoot = `${await fs.realpath(compilerRoot)}${join("/")}`;
    if (!resolvedDependency.startsWith(resolvedCompilerRoot)) {
      throw new Error(
        `packaged plugin compiler resolved ${dependency} outside its package: ${resolvedDependency}`,
      );
    }
  }

  const binaryPath = packagedEsbuildBinary(resources);
  await fs.access(binaryPath);
  const previousBinaryPath = process.env.ESBUILD_BINARY_PATH;
  process.env.ESBUILD_BINARY_PATH = binaryPath;
  try {
    await import(pathToFileURL(compilerFile).href);
    const { transform } = await import(
      pathToFileURL(join(esbuildRoot, "lib", "main.js")).href
    );
    const result = await transform("const answer: number = 42", {
      loader: "ts",
    });
    if (!result.code.includes("answer = 42")) {
      throw new Error(`packaged plugin compiler produced unexpected output: ${compilerFile}`);
    }
  } finally {
    if (previousBinaryPath === undefined) delete process.env.ESBUILD_BINARY_PATH;
    else process.env.ESBUILD_BINARY_PATH = previousBinaryPath;
  }
}

const platforms = await findPluginPlatforms(releaseRoot);
if (platforms.length === 0) {
  throw new Error(`no packaged plugin-platform found below ${releaseRoot}`);
}

for (const platform of platforms) {
  const contracts = await directories(join(platform, "plugins"));
  const featurePlugins = contracts.filter((id) => !id.endsWith("-base"));
  if (featurePlugins.length > 0) {
    throw new Error(`feature plugins shipped in ${platform}: ${featurePlugins.join(", ")}`);
  }

  const corePlugins = await directories(join(platform, "core-plugins"));
  const compiledPlugins = await directories(join(platform, "cache"));
  for (const [label, actual] of [
    ["core source", corePlugins],
    ["compiled core", compiledPlugins],
  ]) {
    if (JSON.stringify(actual) !== JSON.stringify(expectedCorePlugins)) {
      throw new Error(`${label} plugins in ${basename(platform)}: ${actual.join(", ")}`);
    }
  }
  await assertNoAgentFiles(platform);
  await verifyPackagedCompiler(platform);
}

console.log(
  `verified ${platforms.length} packaged application layout(s): contracts, ${expectedCorePlugins.length} core plugins, and live compiler`,
);

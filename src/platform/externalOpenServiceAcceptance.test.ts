// @vitest-environment node

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { rgPath } from "@vscode/ripgrep";
import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedPluginTree, TermcoProfileV3 } from "./contracts";
import { LiveGraphController, LiveReplacementError } from "./liveReplacement";
import { createCompiledModuleLoader } from "./moduleLoader";
import { resolvePluginTree } from "./resolve";
import { CapabilityRuntime } from "./runtime";
import { loadProfileManifests } from "./sourceCatalog";

interface DiscoveredSource {
  root: string;
  manifest: { id: string; version: string };
}

interface CompileResult {
  pluginId: string;
  outputRoot: string;
  outputs: Record<string, string>;
  integrity: string;
}

interface CompilerApi {
  discoverPluginSource(root: string): Promise<DiscoveredSource>;
  compilePlugin(
    source: DiscoveredSource,
    cacheRoot: string,
  ): Promise<CompileResult>;
}

interface PackageFixture {
  root: string;
  id: string;
  version: string;
}

const repositoryRoot = process.cwd();
const compilerEntry = join(repositoryRoot, "scripts/plugin-compiler.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function compilerApi(): Promise<CompilerApi> {
  return (await import(pathToFileURL(compilerEntry).href)) as CompilerApi;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePackage(input: {
  parent: string;
  folder: string;
  id: string;
  version: string;
  source: string;
}): Promise<PackageFixture> {
  const root = join(input.parent, input.folder);
  await fs.mkdir(join(root, "src"), { recursive: true });
  await writeJson(join(root, "package.json"), {
    name: `@external-acceptance/${input.folder}`,
    version: input.version,
    private: true,
    type: "module",
    dependencies: { "@termco/kernel": "*" },
  });
  await writeJson(join(root, "termco-plugin.json"), {
    schemaVersion: 3,
    id: input.id,
    name: input.folder,
    description: "A runtime-created external open-service acceptance package.",
    category: "External acceptance",
    version: input.version,
    entrypoints: { utility: "src/main.ts" },
    dependencies: { "@termco/kernel": "*" },
    activation: "eager",
  });
  await fs.writeFile(join(root, "src/main.ts"), input.source);
  return { root, id: input.id, version: input.version };
}

function profile(
  id: string,
  provider: PackageFixture,
  consumer: PackageFixture,
): TermcoProfileV3 {
  return {
    schemaVersion: 3,
    id,
    bundles: [],
    plugins: [
      { id: consumer.id, module: consumer.root },
      { id: provider.id, module: provider.root },
    ],
    patches: [],
  };
}

async function treeFor(
  id: string,
  provider: PackageFixture,
  consumer: PackageFixture,
): Promise<ResolvedPluginTree> {
  const selected = profile(id, provider, consumer);
  return resolvePluginTree({
    profile: selected,
    manifests: await loadProfileManifests(repositoryRoot, selected),
  });
}

function state(runtime: CapabilityRuntime, pluginId: string) {
  return runtime.inspect().find((fiber) => fiber.pluginId === pluginId);
}

describe("external open-service acceptance", () => {
  it("compiles independent packages and preserves pending, replacement, and rollback semantics", async () => {
    const nonce = randomUUID();
    const serviceName = `external.acceptance.${nonce}`;
    const observationName = `external.acceptance.observation.${nonce}`;
    const repositorySearch = spawnSync(
      rgPath,
      [
        "--fixed-strings",
        "--quiet",
        "--hidden",
        "--glob",
        "!.git/**",
        "--glob",
        "!node_modules/**",
        "--glob",
        "!.termco-cache/**",
        serviceName,
        repositoryRoot,
      ],
      { encoding: "utf8" },
    );
    expect(
      repositorySearch.status,
      repositorySearch.stderr ||
        "the run-unique service name must not exist in the checkout",
    ).toBe(1);

    const externalRoot = await fs.mkdtemp(
      join(tmpdir(), "termco-external-open-service-"),
    );
    temporaryRoots.push(externalRoot);
    expect(isAbsolute(externalRoot)).toBe(true);
    expect(relative(repositoryRoot, externalRoot).startsWith("..")).toBe(true);

    const providerId = "external.acceptance.provider";
    const consumerId = "external.acceptance.consumer";
    const providerSource = (value: string) => `
import type { PluginModule } from "@termco/kernel";

const module: PluginModule = {
  activate(context) {
    context.provide(${JSON.stringify(serviceName)}, {
      read: () => ${JSON.stringify(value)},
    });
  },
};

export default module;
`;
    const consumerSource = `
import type { PluginModule } from "@termco/kernel";

interface ExternalService { read(): string }

const module: PluginModule = {
  inject: [${JSON.stringify(serviceName)}],
  activate(context) {
    const external = context.get<ExternalService>(${JSON.stringify(serviceName)});
    context.provide(${JSON.stringify(observationName)}, {
      value: external.read(),
    });
  },
};

export default module;
`;
    const failedProviderSource = `
import type { PluginModule } from "@termco/kernel";

const module: PluginModule = {
  activate() {
    throw new Error("external candidate rejected");
  },
};

export default module;
`;

    const [providerV1, providerV2, failedProvider, consumer] =
      await Promise.all([
        writePackage({
          parent: externalRoot,
          folder: "provider-v1",
          id: providerId,
          version: "1.0.0",
          source: providerSource("first external value"),
        }),
        writePackage({
          parent: externalRoot,
          folder: "provider-v2",
          id: providerId,
          version: "2.0.0",
          source: providerSource("replacement external value"),
        }),
        writePackage({
          parent: externalRoot,
          folder: "provider-failed",
          id: providerId,
          version: "3.0.0",
          source: failedProviderSource,
        }),
        writePackage({
          parent: externalRoot,
          folder: "consumer",
          id: consumerId,
          version: "1.0.0",
          source: consumerSource,
        }),
      ]);

    const cacheRoot = join(externalRoot, "compiled-cache");
    const compiler = await compilerApi();
    const compiled: CompileResult[] = [];
    for (const sourceRoot of [
      providerV1.root,
      consumer.root,
      providerV2.root,
      failedProvider.root,
    ]) {
      const discovered = await compiler.discoverPluginSource(sourceRoot);
      compiled.push(await compiler.compilePlugin(discovered, cacheRoot));
    }
    expect(new Set(compiled.map((result) => result.outputRoot)).size).toBe(4);
    expect(
      compiled.every(
        (result) =>
          relative(repositoryRoot, result.outputRoot).startsWith("..") &&
          result.integrity.startsWith("sha256-") &&
          typeof result.outputs.utility === "string",
      ),
    ).toBe(true);

    const v1Tree = await treeFor(
      "external.acceptance.v1",
      providerV1,
      consumer,
    );
    const loadV1 = createCompiledModuleLoader({
      tree: v1Tree,
      process: "utility",
      cacheRoot,
    });
    const runtime = new CapabilityRuntime(v1Tree);

    await runtime.activate(consumerId, await loadV1(consumerId));
    expect(state(runtime, consumerId)).toMatchObject({
      state: "pending",
      missingServices: [serviceName],
    });

    await runtime.activate(providerId, await loadV1(providerId));
    runtime.assertSettled();
    expect(
      runtime.platformCapability<{ value: string }>(observationName).value,
    ).toBe("first external value");

    await runtime.deactivate(providerId);
    expect(state(runtime, providerId)).toMatchObject({ state: "inactive" });
    expect(state(runtime, consumerId)).toMatchObject({
      state: "pending",
      missingServices: [serviceName],
    });
    expect(() => runtime.platformCapability(observationName)).toThrow(
      /unavailable in this process/,
    );

    const v2Tree = await treeFor(
      "external.acceptance.v2",
      providerV2,
      consumer,
    );
    const loadV2 = createCompiledModuleLoader({
      tree: v2Tree,
      process: "utility",
      cacheRoot,
    });
    await runtime.activate(providerId, await loadV2(providerId));
    runtime.assertSettled();
    expect(state(runtime, consumerId)).toMatchObject({ state: "active" });
    expect(
      runtime.platformCapability<{ value: string }>(observationName).value,
    ).toBe("replacement external value");

    const failedTree = await treeFor(
      "external.acceptance.failed",
      failedProvider,
      consumer,
    );
    const loadFailed = createCompiledModuleLoader({
      tree: failedTree,
      process: "utility",
      cacheRoot,
    });
    const controller = new LiveGraphController(runtime);
    const replacementError = await controller
      .replace(failedTree, loadFailed, () => true)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(replacementError).toBeInstanceOf(LiveReplacementError);
    expect(replacementError).toMatchObject({
      phase: "candidate-activation",
      previousProviderRestored: true,
    });
    expect((replacementError as Error).message).toContain(
      "external candidate rejected",
    );
    controller.runtime.assertSettled();
    expect(
      controller.runtime.platformCapability<{ value: string }>(observationName)
        .value,
    ).toBe("replacement external value");
  }, 15_000);
});

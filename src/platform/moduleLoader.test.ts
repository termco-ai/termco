// @vitest-environment node

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TermcoPluginManifestV3, TermcoProfileV3 } from "./contracts";
import {
  createCompiledModuleLoader,
  locateCompiledPlugin,
  qualifyCompiledPluginGenerations,
} from "./moduleLoader";
import { resolvePluginTree } from "./resolve";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true })),
  );
});

async function fixture() {
  const cacheRoot = await fs.mkdtemp(join(tmpdir(), "termco-module-loader-"));
  roots.push(cacheRoot);
  const manifest: TermcoPluginManifestV3 = {
    schemaVersion: 3,
    id: "test-provider",
    name: "Test Provider",
    description: "Provides a test value",
    category: "Test",
    version: "1.0.0",
    entrypoints: { main: "src/main.ts" },
    dependencies: {},
  };
  const profile: TermcoProfileV3 = {
    schemaVersion: 3,
    id: "test.profile",
    bundles: [],
    plugins: [
      {
        id: manifest.id,
        module: "./plugins/test-provider",
      },
    ],
    patches: [],
  };
  const tree = resolvePluginTree({
    profile,
    manifests: new Map([[manifest.id, manifest]]),
  });
  const integrity = `sha256-${"b".repeat(64)}`;
  const outputRoot = join(cacheRoot, manifest.id, manifest.version);
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(join(outputRoot, "integrity.txt"), `${integrity}\n`);
  await fs.writeFile(
    join(outputRoot, "main.mjs"),
    "export default { activate(context) { context.provide('test.value', 42); } };\n",
  );
  tree.plugins[0].source.integrity = integrity;
  return { cacheRoot, tree, plugin: tree.plugins[0] };
}

describe("compiled plugin loader", () => {
  it("loads a source-certified artifact directly", async () => {
    const { cacheRoot, tree } = await fixture();
    const load = createCompiledModuleLoader({
      tree,
      process: "main",
      cacheRoot,
    });
    const module = await load("test-provider");
    expect(module.activate).toBeTypeOf("function");
  });

  it("pins an unqualified profile row to the generation it will execute", async () => {
    const { cacheRoot, plugin } = await fixture();
    const expected = plugin.source.integrity;
    delete plugin.source.integrity;

    const location = await locateCompiledPlugin(plugin, "main", cacheRoot);

    expect(location.integrity).toBe(expected);
    expect(plugin.source.integrity).toBe(expected);
  });

  it("repairs node-pty spawn helpers in an existing compiled generation", async () => {
    const { cacheRoot, plugin } = await fixture();
    const helper = join(
      cacheRoot,
      plugin.id,
      plugin.manifest.version,
      "node_modules",
      "node-pty",
      "prebuilds",
      "darwin-arm64",
      "spawn-helper",
    );
    await fs.mkdir(join(helper, ".."), { recursive: true });
    await fs.writeFile(helper, "helper\n", { mode: 0o644 });

    await locateCompiledPlugin(plugin, "main", cacheRoot);

    if (process.platform !== "win32") {
      expect((await fs.stat(helper)).mode & 0o111).toBe(0o111);
    }
  });

  it("qualifies a complete tree before replacement identity is compared", async () => {
    const { cacheRoot, tree, plugin } = await fixture();
    const expected = plugin.source.integrity;
    delete plugin.source.integrity;

    await qualifyCompiledPluginGenerations(tree, cacheRoot);

    expect(tree.plugins[0]?.source.integrity).toBe(expected);
  });

  it("rejects cache output whose integrity differs from the source", async () => {
    const { cacheRoot, plugin } = await fixture();
    await fs.writeFile(
      join(cacheRoot, "test-provider", "1.0.0", "integrity.txt"),
      `sha256-${"c".repeat(64)}\n`,
    );
    await expect(
      locateCompiledPlugin(plugin, "main", cacheRoot),
    ).rejects.toThrow(/does not match source integrity/);
  });

  it("selects the cache root whose integrity matches the source", async () => {
    const { cacheRoot: first, plugin } = await fixture();
    await fs.writeFile(
      join(first, plugin.manifest.id, plugin.manifest.version, "integrity.txt"),
      `sha256-${"c".repeat(64)}\n`,
    );
    const second = await fs.mkdtemp(
      join(tmpdir(), "termco-module-loader-user-"),
    );
    roots.push(second);
    const pluginRoot = join(
      second,
      plugin.manifest.id,
      plugin.manifest.version,
    );
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      join(pluginRoot, "integrity.txt"),
      `${plugin.source.integrity}\n`,
    );
    await fs.writeFile(join(pluginRoot, "main.mjs"), "export default {}\n");

    const location = await locateCompiledPlugin(plugin, "main", [
      first,
      second,
    ]);
    expect(location.root).toBe(pluginRoot);
  });
});

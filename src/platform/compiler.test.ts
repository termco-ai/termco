// @vitest-environment node

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const pluginCompiler = await import(
  pathToFileURL(join(process.cwd(), "scripts/plugin-compiler.mjs")).href
);

const {
  compileAllPlugins,
  compilePlugin,
  copyPackageFiles,
  discoverPluginSource,
  discoverPluginSources,
  isAbsoluteImportPath,
  isPathInside,
  resolveImportPath,
} = pluginCompiler;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true })),
  );
});

async function fixture(
  source: string,
  dependencies: Record<string, string> = {},
  manifestPatch: Record<string, unknown> = {},
) {
  const root = await fs.mkdtemp(join(tmpdir(), "termco-plugin-v3-"));
  roots.push(root);
  const pluginRoot = join(root, "plugins", "test.plugin");
  await fs.mkdir(join(pluginRoot, "src"), { recursive: true });
  await fs.writeFile(join(pluginRoot, "package.json"), '{"type":"module"}');
  await fs.writeFile(join(pluginRoot, "README.md"), "# Test plugin\n");
  await fs.writeFile(join(pluginRoot, "AGENTS.md"), "# Boundary\n");
  await fs.writeFile(
    join(pluginRoot, "termco-plugin.json"),
    JSON.stringify({
      schemaVersion: 3,
      id: "test.plugin",
      name: "Test",
      description: "A complete source-owning test plugin.",
      category: "Test",
      version: "1.0.0",
      entrypoints: { utility: "src/index.ts" },
      dependencies,
      ...manifestPatch,
    }),
  );
  await fs.writeFile(join(pluginRoot, "src", "index.ts"), source);
  await fs.writeFile(join(pluginRoot, "src", "index.test.ts"), "export {};\n");
  return root;
}

describe("package-aware plugin compiler", () => {
  it("recognizes absolute import paths from every build platform", () => {
    expect(isAbsoluteImportPath("/workspace/plugin/src/main.ts")).toBe(true);
    expect(isAbsoluteImportPath("D:\\a\\termco\\src\\main.ts")).toBe(true);
    expect(isAbsoluteImportPath("./src/main.ts")).toBe(false);
    expect(isAbsoluteImportPath("react")).toBe(false);
  });

  it("keeps Windows esbuild entry paths inside their plugin boundary", () => {
    const pluginRoot =
      "D:\\a\\termco\\termco\\core-plugins\\boot-diagnostics-native";
    const resolveDirectory = `${pluginRoot}\\src`;
    const entry = `${resolveDirectory}\\renderer.ts`;
    const candidate = resolveImportPath(resolveDirectory, entry);

    expect(candidate).toBe(entry);
    expect(isPathInside(pluginRoot, candidate)).toBe(true);
    expect(
      isPathInside(pluginRoot, "D:\\a\\termco\\termco\\src\\private.ts"),
    ).toBe(false);
  });

  it("preserves POSIX semantics for absolute source paths", () => {
    const pluginRoot = "/workspace/core-plugins/boot-diagnostics-native";
    const resolveDirectory = `${pluginRoot}/src`;
    const candidate = resolveImportPath(resolveDirectory, "./renderer.ts");

    expect(candidate).toBe(`${resolveDirectory}/renderer.ts`);
    expect(isPathInside(pluginRoot, candidate)).toBe(true);
    expect(isPathInside(pluginRoot, "/workspace/src/private.ts")).toBe(false);
  });

  it("copies runtime packages without nested dependencies and preserves executable files", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "termco-runtime-package-"));
    roots.push(root);
    const source = join(root, "source");
    const target = join(root, "target");
    await fs.mkdir(join(source, "bin"), { recursive: true });
    await fs.mkdir(join(source, "node_modules", "ignored"), { recursive: true });
    await fs.writeFile(join(source, "package.json"), '{"name":"fixture"}\n');
    await fs.writeFile(join(source, "bin", "worker"), "#!/bin/sh\n", {
      mode: 0o755,
    });
    await fs.writeFile(
      join(source, "node_modules", "ignored", "package.json"),
      "{}\n",
    );

    await copyPackageFiles(source, target);

    await expect(fs.readFile(join(target, "package.json"), "utf8")).resolves.toContain(
      "fixture",
    );
    const copiedWorker = join(target, "bin", "worker");
    await expect(fs.readFile(copiedWorker, "utf8")).resolves.toBe("#!/bin/sh\n");
    if (process.platform !== "win32") {
      expect((await fs.stat(copiedWorker)).mode & 0o111).toBe(0o111);
    }
    await expect(fs.stat(join(target, "node_modules"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("uses the physical unpacked mode when Electron exposes a read-only ASAR mode", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "termco-asar-runtime-package-"));
    roots.push(root);
    const source = join(root, "fixture.asar", "node_modules", "node-pty");
    const unpacked = join(
      root,
      "fixture.asar.unpacked",
      "node_modules",
      "node-pty",
    );
    const target = join(root, "target");
    const relativeHelper = join("prebuilds", "darwin-arm64", "spawn-helper");
    await fs.mkdir(join(source, "prebuilds", "darwin-arm64"), { recursive: true });
    await fs.mkdir(join(unpacked, "prebuilds", "darwin-arm64"), { recursive: true });
    await fs.writeFile(join(source, "package.json"), '{"name":"node-pty"}\n');
    await fs.writeFile(join(source, relativeHelper), "helper\n", { mode: 0o644 });
    await fs.writeFile(join(unpacked, relativeHelper), "helper\n", { mode: 0o755 });

    await copyPackageFiles(source, target);

    if (process.platform !== "win32") {
      expect((await fs.stat(join(target, relativeHelper))).mode & 0o111).toBe(0o111);
    }
  });

  it("emits the shipped main-process event bridge as a directly loadable cache artifact", async () => {
    const cacheRoot = await fs.mkdtemp(join(tmpdir(), "termco-events-cache-"));
    roots.push(cacheRoot);
    const plugin = await discoverPluginSource(
      join(process.cwd(), "plugin-repository", "plugins", "events-native"),
    );
    const result = await compilePlugin(plugin, cacheRoot);

    const entryUrl = pathToFileURL(result.outputs.main).href;
    expect(() =>
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", `await import(${JSON.stringify(entryUrl)})`],
        { stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("compiles readable source into a disposable cache", async () => {
    const root = await fixture(
      'import type { PluginModule } from "@termco/kernel"; export default { activate() {} } satisfies PluginModule;',
    );
    const results = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    expect(results).toHaveLength(1);
    await expect(fs.stat(results[0].outputs.utility)).resolves.toBeTruthy();
    expect(results[0].outputRoot).not.toContain(
      join("plugins", "test.plugin", "src"),
    );
    expect(results[0].integrity).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  it("rejects host runtime values that Node cache entrypoints cannot resolve", async () => {
    const root = await fixture(
      'import { service } from "@termco/kernel"; export default { activate() { return service("fixture.service"); } };',
    );
    await expect(
      compileAllPlugins({
        pluginsRoot: join(root, "plugins"),
        cacheRoot: join(root, ".cache"),
      }),
    ).rejects.toThrow(/runtime import .*@termco\/kernel.*Node entrypoint/);
  });

  it("copies plugin-owned assets and removes stale cache files", async () => {
    const root = await fixture("export default { activate() {} };");
    const pluginRoot = join(root, "plugins", "test.plugin");
    await fs.mkdir(join(pluginRoot, "assets"));
    await fs.writeFile(join(pluginRoot, "assets", "integration.sh"), "first\n");

    const first = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    expect(
      await fs.readFile(
        join(first[0].outputRoot, "assets", "integration.sh"),
        "utf8",
      ),
    ).toBe("first\n");

    await fs.rm(join(pluginRoot, "assets", "integration.sh"));
    await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    await expect(
      fs.stat(join(first[0].outputRoot, "assets", "integration.sh")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("publishes only complete cache versions and preserves the last valid build on failure", async () => {
    const root = await fixture(
      'export const marker = "first"; export default { activate() {} };',
    );
    const cacheRoot = join(root, ".cache");
    const pluginRoot = join(root, "plugins", "test.plugin");
    const manifestPath = join(pluginRoot, "termco-plugin.json");
    const firstPlugin = await discoverPluginSource(pluginRoot);
    const first = await compilePlugin(firstPlugin, cacheRoot);
    const firstUtility = await fs.readFile(first.outputs.utility);
    const firstIntegrity = await fs.readFile(
      join(first.outputRoot, "integrity.txt"),
    );

    await fs.writeFile(
      join(pluginRoot, "src", "index.ts"),
      'export const marker = "second"; export default { activate() {} };',
    );
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.assetBuilds = [
      {
        entry: "src/missing-late-asset.ts",
        output: "assets/late.mjs",
        platform: "node",
      },
    ];
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    await expect(
      compilePlugin(await discoverPluginSource(pluginRoot), cacheRoot),
    ).rejects.toThrow();
    await expect(fs.readFile(first.outputs.utility)).resolves.toEqual(
      firstUtility,
    );
    await expect(
      fs.readFile(join(first.outputRoot, "integrity.txt")),
    ).resolves.toEqual(firstIntegrity);

    manifest.version = "1.0.1";
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await expect(
      compilePlugin(await discoverPluginSource(pluginRoot), cacheRoot),
    ).rejects.toThrow();
    await expect(
      fs.stat(join(cacheRoot, "test.plugin", "1.0.1")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await fs.readdir(join(cacheRoot, "test.plugin"))).filter((name) =>
        name.startsWith("."),
      ),
    ).toEqual([]);
  });

  it("builds plugin-owned runtime assets from readable source into the cache", async () => {
    const root = await fixture("export default { activate() {} };");
    const pluginRoot = join(root, "plugins", "test.plugin");
    const manifestPath = join(pluginRoot, "termco-plugin.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.assetBuilds = [
      {
        entry: "src/server.ts",
        output: "assets/server/runtime.mjs",
        platform: "node",
        target: "node18",
      },
    ];
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.writeFile(
      join(pluginRoot, "src", "server.ts"),
      'const marker = "plugin-owned-runtime"; console.log(marker);\n',
    );

    const [result] = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    const output = join(result.outputRoot, "assets", "server", "runtime.mjs");
    await expect(fs.readFile(output, "utf8")).resolves.toContain(
      "plugin-owned-runtime",
    );
    await expect(
      fs.stat(join(pluginRoot, "assets", "server", "runtime.mjs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bridges generated JSX through the host's default-export runtime shim", async () => {
    const root = await fixture(
      "export default { activate() { return () => <div>plugin ui</div>; } };",
    );
    const pluginRoot = join(root, "plugins", "test.plugin");
    await fs.rename(
      join(pluginRoot, "src", "index.ts"),
      join(pluginRoot, "src", "index.tsx"),
    );
    const manifestPath = join(pluginRoot, "termco-plugin.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.entrypoints = { renderer: "src/index.tsx" };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    const [result] = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    const output = await fs.readFile(result.outputs.renderer, "utf8");
    expect(output).toContain('import runtime from "@termco/react/jsx-runtime"');
    expect(output).not.toContain("import { jsx");
  });

  it("rejects private imports outside the plugin folder", async () => {
    const root = await fixture(
      'import secret from "../../../src/modules/secret"; export default secret;',
    );
    await expect(
      compileAllPlugins({
        pluginsRoot: join(root, "plugins"),
        cacheRoot: join(root, ".cache"),
      }),
    ).rejects.toThrow(/imports private source outside its plugin folder/);
  });

  it("rejects the removed transitional host-import manifest escape hatch", async () => {
    const root = await fixture(
      'import { shared } from "@/platform/shared"; export default { activate() { return shared; } };',
      {},
      { transitionalHostImports: ["@/platform/shared"] },
    );
    await expect(
      compileAllPlugins({
        pluginsRoot: join(root, "plugins"),
        cacheRoot: join(root, ".cache"),
      }),
    ).rejects.toThrow(/transitionalHostImports is not supported/);
  });

  it("rejects direct imports from the removed private app runtime", async () => {
    const root = await fixture(
      'import runtime from "@termco/app/platform/shared"; export default runtime;',
    );
    await expect(
      compileAllPlugins({
        pluginsRoot: join(root, "plugins"),
        cacheRoot: join(root, ".cache"),
      }),
    ).rejects.toThrow(/imports private Termco source/);
  });

  it("rejects private imports hidden in source outside the entrypoint graph", async () => {
    const root = await fixture("export default { activate() {} };");
    await fs.writeFile(
      join(root, "plugins", "test.plugin", "src", "unused.ts"),
      'import secret from "../../../src/modules/secret"; export default secret;',
    );
    await expect(
      compileAllPlugins({
        pluginsRoot: join(root, "plugins"),
        cacheRoot: join(root, ".cache"),
      }),
    ).rejects.toThrow(/imports private source outside its plugin folder/);
  });

  it("rejects undeclared third-party packages", async () => {
    const root = await fixture(
      'import React from "react"; export default React;',
    );
    await expect(
      compileAllPlugins({
        pluginsRoot: join(root, "plugins"),
        cacheRoot: join(root, ".cache"),
      }),
    ).rejects.toThrow(/imports undeclared dependency "react"/);
  });

  it("materializes declared Node dependencies beside a disposable plugin cache", async () => {
    const root = await fixture(
      'import { rgPath } from "@vscode/ripgrep"; export default { rgPath };',
      { "@vscode/ripgrep": "^1.15.14" },
    );
    const [result] = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });

    await expect(
      fs.stat(join(result.outputRoot, "node_modules", "@vscode", "ripgrep")),
    ).resolves.toBeTruthy();
    expect(() =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `const loaded = await import(${JSON.stringify(pathToFileURL(result.outputs.utility).href)}); if (!/rg(?:\\.exe)?$/.test(loaded.default.rgPath)) process.exit(2);`,
        ],
        { cwd: root, env: { ...process.env, NODE_PATH: "" }, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  it("maps declared renderer dependencies onto the host runtime namespace", async () => {
    const root = await fixture(
      'import { generateText as generate } from "ai"; export default { activate() { return generate; } };',
      { ai: "^7.0.0" },
    );
    const pluginRoot = join(root, "plugins", "test.plugin");
    const manifestPath = join(pluginRoot, "termco-plugin.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.entrypoints = { renderer: "src/index.ts" };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const [result] = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    const output = await fs.readFile(result.outputs.renderer, "utf8");
    expect(output).toContain('from "@termco/ai"');
    expect(output).toContain("const { generateText: generate }");
    expect(output).not.toContain('from "ai"');
  });

  it("accepts declared scoped renderer dependencies across the whole owned source tree", async () => {
    const root = await fixture(
      'import { Search01Icon } from "@hugeicons/core-free-icons"; import { HugeiconsIcon } from "@hugeicons/react"; export default { activate() { return [Search01Icon, HugeiconsIcon]; } };',
      {
        "@hugeicons/core-free-icons": "^4.2.0",
        "@hugeicons/react": "^1.1.7",
      },
    );
    const pluginRoot = join(root, "plugins", "test.plugin");
    const manifestPath = join(pluginRoot, "termco-plugin.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.entrypoints = { renderer: "src/index.ts" };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    const [result] = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    const output = await fs.readFile(result.outputs.renderer, "utf8");
    expect(output).toContain('from "@termco/@hugeicons/core-free-icons"');
    expect(output).toContain('from "@termco/@hugeicons/react"');
  });

  it("maps namespace imports onto the host runtime's default export", async () => {
    const root = await fixture(
      'import * as panels from "react-resizable-panels"; export default { activate() { return panels.Group; } };',
      { "react-resizable-panels": "^3.0.0" },
    );
    const pluginRoot = join(root, "plugins", "test.plugin");
    const manifestPath = join(pluginRoot, "termco-plugin.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.entrypoints = { renderer: "src/index.ts" };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const [result] = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    const output = await fs.readFile(result.outputs.renderer, "utf8");
    expect(output).toContain(
      'import panels from "@termco/react-resizable-panels";',
    );
    expect(output).not.toContain("import * as panels");
  });

  it("preserves a scoped package identity when mapping renderer dependencies", async () => {
    const root = await fixture(
      'import { icons } from "@iconify-json/catppuccin"; export default icons;',
      { "@iconify-json/catppuccin": "^1.2.17" },
    );
    const pluginRoot = join(root, "plugins", "test.plugin");
    const manifestPath = join(pluginRoot, "termco-plugin.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.entrypoints = { renderer: "src/index.ts" };
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const [result] = await compileAllPlugins({
      pluginsRoot: join(root, "plugins"),
      cacheRoot: join(root, ".cache"),
    });
    const output = await fs.readFile(result.outputs.renderer, "utf8");
    expect(output).toContain('from "@termco/@iconify-json/catppuccin"');
    expect(output).not.toContain("catppuccin/icons.json");
  });

  it("requires self-describing manifests", async () => {
    const root = await fixture("export default {};");
    const pluginRoot = join(root, "plugins", "test.plugin");
    const manifest = JSON.parse(
      await fs.readFile(join(pluginRoot, "termco-plugin.json"), "utf8"),
    );
    delete manifest.description;
    await fs.writeFile(
      join(pluginRoot, "termco-plugin.json"),
      JSON.stringify(manifest),
    );
    await expect(discoverPluginSources(join(root, "plugins"))).rejects.toThrow(
      /description and category are required/,
    );
  });

  it("can compile one selected source even when a sibling folder is broken", async () => {
    const root = await fixture("export default { activate() {} };");
    await fs.mkdir(join(root, "plugins", "broken.plugin"));
    const selected = await discoverPluginSource(
      join(root, "plugins", "test.plugin"),
    );
    const result = await compilePlugin(selected, join(root, ".cache"));
    expect(result.pluginId).toBe("test.plugin");
  });

  it("compiles copied shipped source against its declared base contracts", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "termco-copied-plugin-"));
    roots.push(root);
    const copiedRoot = join(root, "plugins", "agents-manager-native");
    await fs.mkdir(join(root, "plugins"), { recursive: true });
    await fs.cp(
      join(
        process.cwd(),
        "plugin-repository",
        "plugins",
        "agents-manager-native",
      ),
      copiedRoot,
      { recursive: true },
    );

    const result = await compilePlugin(
      await discoverPluginSource(copiedRoot),
      join(root, ".cache"),
      { dependencyRoot: join(process.cwd(), "node_modules") },
    );

    expect(result.pluginId).toBe("agents-manager-native");
    await expect(fs.stat(result.outputs.renderer)).resolves.toBeTruthy();
  });
});

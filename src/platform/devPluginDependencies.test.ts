// @vitest-environment node
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { affectedPluginRoots } from "../../scripts/dev-plugin-dependencies.mjs";
const { compilePlugin, discoverPluginSource } = await import(pathToFileURL(join(process.cwd(), "scripts/plugin-compiler-lib.mjs")).href);

it("rebuilds bundled base consumers and transitive dependents before restart", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "termco-dev-dependencies-"));
  try {
    const sources = join(root, "sources");
    const base = join(sources, "fixture-base");
    const middle = join(sources, "middle-base");
    const consumer = join(sources, "consumer");
    const unrelated = join(sources, "unrelated");
    for (const [path, name, dependencies, source] of [
      [base, "@termco/fixture-base", {}, 'export const value = "old-value";'],
      [middle, "@termco/middle-base", { "@termco/fixture-base": "1.0.0" }, 'export { value } from "@termco/fixture-base";'],
      [consumer, "consumer", { "@termco/middle-base": "1.0.0", "@termco/fixture-base": "1.0.0" }, 'import { value } from "@termco/middle-base"; export const answer = value;'],
      [unrelated, "unrelated", {}, 'export const answer = 1;'],
    ] as const) {
      await fs.mkdir(join(path, "src"), { recursive: true });
      await fs.writeFile(join(path, "package.json"), JSON.stringify({ name, type: "module", exports: "./src/index.ts", dependencies }));
      await fs.writeFile(join(path, "termco-plugin.json"), JSON.stringify({ schemaVersion: 3, description: "Dependency regression fixture", category: "Test", id: name.replace("@termco/", ""), name, version: "1.0.0", dependencies, ...(name.endsWith("-base") ? {} : { entrypoints: { utility: "src/index.ts" } }) }));
      await fs.writeFile(join(path, "src/index.ts"), source);
    }
    const dependencyRoot = join(root, "node_modules");
    await fs.mkdir(join(dependencyRoot, "@termco"), { recursive: true });
    await fs.symlink(base, join(dependencyRoot, "@termco/fixture-base"), "dir");
    await fs.symlink(middle, join(dependencyRoot, "@termco/middle-base"), "dir");
    const cache = join(root, "cache");
    const before = await compilePlugin(await discoverPluginSource(consumer), cache, { dependencyRoot });
    expect(await fs.readFile(before.outputs.utility, "utf8")).toContain("old-value");
    await fs.writeFile(join(base, "src/index.ts"), 'export const value = "new-value";');
    const affected = await affectedPluginRoots([sources], [base]);
    expect(new Set(affected)).toEqual(new Set([base, middle, consumer]));
    for (const path of affected) await compilePlugin(await discoverPluginSource(path), cache, { dependencyRoot });
    expect(await fs.readFile(before.outputs.utility, "utf8")).toContain("new-value");
    expect(await affectedPluginRoots([sources], [consumer])).toEqual([consumer]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);

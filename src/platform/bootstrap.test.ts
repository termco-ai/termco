// @vitest-environment node

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareProfileProcess } from "./bootstrap";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true })),
  );
});

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "termco-bootstrap-v3-"));
  roots.push(root);
  const profilesRoot = join(root, "profiles");
  const pluginRoot = join(root, "plugins", "test-provider");
  const cacheRoot = join(root, ".cache");
  const outputRoot = join(cacheRoot, "test-provider", "1.0.0");
  await fs.mkdir(join(profilesRoot, "default"), { recursive: true });
  await fs.mkdir(pluginRoot, { recursive: true });
  await fs.mkdir(outputRoot, { recursive: true });
  const manifest = {
    schemaVersion: 3,
    id: "test-provider",
    name: "Test Provider",
    description: "Provides a test capability.",
    category: "Test",
    version: "1.0.0",
    entrypoints: { main: "src/main.ts" },
    dependencies: {},
  };
  await fs.writeFile(
    join(pluginRoot, "termco-plugin.json"),
    JSON.stringify(manifest),
  );
  await fs.writeFile(
    join(profilesRoot, "default", "profile.json"),
    JSON.stringify({
      schemaVersion: 3,
      id: "test.default",
      bundles: [],
      plugins: [
        {
          id: manifest.id,
          module: "./plugins/test-provider",
        },
      ],
      patches: [],
    }),
  );
  const integrity = `sha256-${"d".repeat(64)}`;
  await fs.writeFile(join(outputRoot, "integrity.txt"), `${integrity}\n`);
  await fs.writeFile(
    join(outputRoot, "main.mjs"),
    "export default { activate(context) { context.provide('test.value', { read: () => 42, generation: () => context.generation }); } };\n",
  );
  return { root, profilesRoot, cacheRoot, integrity };
}

describe("prepareProfileProcess", () => {
  it("imports no plugin code until the fully validated process activates", async () => {
    const input = await fixture();
    const prepared = await prepareProfileProcess({
      repositoryRoot: input.root,
      profilesRoot: input.profilesRoot,
      activeProfileId: "test.default",
      cacheRoot: input.cacheRoot,
      process: "main",
    });
    expect(prepared.runtime.inspect()[0].state).toBe("inactive");
    await prepared.activate();
    expect(prepared.runtime.inspect()[0].state).toBe("active");
    expect(
      await prepared.runtime.callCapability("test.value", "read", []),
    ).toBe(42);
    expect(prepared.tree.plugins[0]?.source.integrity).toBe(input.integrity);
    expect(
      await prepared.runtime.callCapability("test.value", "generation", []),
    ).toBe(input.integrity);
  });

  it("ignores obsolete lockfile data during startup", async () => {
    const input = await fixture();
    await fs.writeFile(
      join(input.profilesRoot, "default", "profile.lock.json"),
      "{ obsolete invalid lock",
    );
    const prepared = await prepareProfileProcess({
      repositoryRoot: input.root,
      profilesRoot: input.profilesRoot,
      activeProfileId: "test.default",
      cacheRoot: input.cacheRoot,
      process: "main",
    });
    await prepared.activate();
    expect(prepared.runtime.inspect()[0].state).toBe("active");
  });
});

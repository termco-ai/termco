// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TermcoProfileV3 } from "./contracts";
import { loadProfileDirectory, loadProfileManifests } from "./sourceCatalog";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))),
);

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "termco-source-v3-"));
  roots.push(value);
  return value;
}

describe("v3 source catalogue", () => {
  it("loads profiles without reading an obsolete lockfile", async () => {
    const directory = await root();
    const profile: TermcoProfileV3 = {
      schemaVersion: 3,
      id: "empty",
      bundles: [],
      plugins: [],
      patches: [],
    };
    await mkdir(join(directory, "empty"), { recursive: true });
    await writeFile(
      join(directory, "empty", "profile.json"),
      JSON.stringify(profile),
    );
    await writeFile(
      join(directory, "empty", "profile.lock.json"),
      "{ invalid legacy lock",
    );
    expect((await loadProfileDirectory(directory)).get("empty")).toEqual(
      profile,
    );
  });

  it("resolves file rows and permits stable row ids to select replacement packages", async () => {
    const directory = await root();
    const packageRoot = join(directory, "replacement");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, "termco-plugin.json"),
      JSON.stringify({
        schemaVersion: 3,
        id: "company.counter-provider",
        name: "Counter",
        description: "Replacement counter",
        category: "Test",
        version: "1.0.0",
        entrypoints: { utility: "src/main.ts" },
        dependencies: {},
      }),
    );
    const manifests = await loadProfileManifests(directory, {
      schemaVersion: 3,
      id: "replacement",
      bundles: [],
      plugins: [{ id: "counter.provider", module: `file://${packageRoot}` }],
      patches: [],
    });
    expect(manifests.get("counter.provider")?.id).toBe(
      "company.counter-provider",
    );
  });
});

// @vitest-environment node
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { TermcoPluginManifestV3, TermcoProfileV3 } from "./contracts";
import { resolvePluginTree } from "./resolve";

const root = resolve(import.meta.dirname, "../..");
const pluginRoots = [
  join(root, "plugin-repository", "plugins"),
  join(root, "core-plugins"),
];
const sourcePluginIds = (
  await Promise.all(
    pluginRoots.map(async (pluginRoot) =>
      (
        await fs.readdir(pluginRoot, { withFileTypes: true })
      )
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ),
  )
)
  .flat()
  .sort();

function pluginRoot(pluginId: string): string {
  return (
    pluginRoots.find(
      (candidate) =>
        sourcePluginIds.includes(pluginId) &&
        candidate.endsWith("core-plugins") === corePluginIds.has(pluginId),
    ) ?? pluginRoots[0]
  );
}

const corePluginIds = new Set([
  "boot-diagnostics-native",
  "plugin-manager-native",
  "safe-recovery-native",
  "settings-native",
  "ui-shell-native",
  "updater-native",
  "workspace-shell-native",
]);

async function manifest(pluginId: string): Promise<TermcoPluginManifestV3> {
  const raw = JSON.parse(
    await fs.readFile(
      join(pluginRoot(pluginId), pluginId, "termco-plugin.json"),
      "utf8",
    ),
  ) as Partial<TermcoPluginManifestV3>;
  return {
    schemaVersion: 3,
    id: typeof raw.id === "string" ? raw.id : pluginId,
    name: typeof raw.name === "string" ? raw.name : pluginId,
    description:
      typeof raw.description === "string" ? raw.description : pluginId,
    category: typeof raw.category === "string" ? raw.category : "Product",
    version: typeof raw.version === "string" ? raw.version : "0.0.0",
    entrypoints: raw.entrypoints ?? { utility: "src/index.ts" },
    dependencies: raw.dependencies ?? {},
  };
}

function profile(pluginId: string): TermcoProfileV3 {
  return {
    schemaVersion: 3,
    id: `removal.${pluginId}`,
    bundles: [],
    plugins: [
      {
        id: pluginId,
        module: corePluginIds.has(pluginId)
          ? `./core-plugins/${pluginId}`
          : `./plugin-repository/plugins/${pluginId}`,
      },
    ],
    patches: [],
  };
}

describe("per-plugin removal certification", () => {
  it.each(
    sourcePluginIds,
  )("%s has no hidden tree fallback when removed", async (pluginId) => {
    const selectedManifest = await manifest(pluginId);
    const selectedProfile = profile(pluginId);
    const selected = resolvePluginTree({
      profile: selectedProfile,
      manifests: new Map([[pluginId, selectedManifest]]),
    });
    expect(selected.activationOrder).toContain(pluginId);

    const removed = resolvePluginTree({
      profile: { ...selectedProfile, plugins: [] },
      manifests: new Map(),
    });
    expect(removed.activationOrder).not.toContain(pluginId);
    expect(removed.plugins.map((plugin) => plugin.id)).not.toContain(pluginId);
    expect(removed.plugins).toEqual([]);
  });
});

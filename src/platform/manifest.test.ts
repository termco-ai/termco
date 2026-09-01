import { describe, expect, it } from "vitest";
import { parsePluginManifestV3 } from "./manifest";

const base = {
  schemaVersion: 3,
  id: "dual-process",
  name: "Dual process",
  description: "Dual-process test plugin",
  category: "Test",
  version: "1.0.0",
  entrypoints: { main: "src/main.ts", renderer: "ui/plugin.tsx" },
  dependencies: { "@termco/example-base": "^1.2.0" },
} as const;

describe("plugin manifest source metadata", () => {
  it("preserves runtime entrypoints and package dependencies", () => {
    expect(parsePluginManifestV3(base)).toEqual({ ok: true, manifest: base });
  });

  it("preserves build and replacement metadata", () => {
    const manifest = {
      ...base,
      assetBuilds: [
        {
          entry: "src/worker.ts",
          output: "assets/worker.mjs",
          platform: "browser",
          target: "es2022",
        },
      ],
      activation: "lazy",
      replaces: "dual-process",
    } as const;

    expect(parsePluginManifestV3(manifest)).toEqual({
      ok: true,
      manifest,
    });
  });

  it("rejects source entries that escape the plugin folder", () => {
    expect(
      parsePluginManifestV3({
        ...base,
        entrypoints: { main: "../main.ts" },
      }),
    ).toEqual({
      ok: false,
      error: "entrypoints.main: must stay inside the plugin folder",
    });
  });
});

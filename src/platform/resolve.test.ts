import { describe, expect, it } from "vitest";
import type { TermcoPluginManifestV3, TermcoProfileV3 } from "./contracts";
import { PluginTreeResolutionError, resolvePluginTree } from "./resolve";

function plugin(id: string, executable = true): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: id,
    description: `${id} description`,
    category: "Test",
    version: "1.0.0",
    ...(executable ? { entrypoints: { utility: "src/index.ts" } } : {}),
    dependencies: {},
  };
}

function profile(
  rows: Array<{ id: string; module?: string; enabled?: boolean }>,
): TermcoProfileV3 {
  return {
    schemaVersion: 3,
    id: "test.profile",
    bundles: [],
    plugins: rows.map((row) => ({
      id: row.id,
      module: row.module ?? `./plugins/${row.id}`,
      ...(row.enabled === undefined ? {} : { enabled: row.enabled }),
    })),
    patches: [],
  };
}

describe("resolvePluginTree", () => {
  it("preserves effective profile order without a dependency catalogue", () => {
    const consumer = plugin("counter.consumer");
    const provider = plugin("counter.provider");
    const tree = resolvePluginTree({
      profile: profile([{ id: consumer.id }, { id: provider.id }]),
      manifests: new Map([
        [consumer.id, consumer],
        [provider.id, provider],
      ]),
    });
    expect(tree.activationOrder).toEqual([
      "counter.consumer",
      "counter.provider",
    ]);
  });

  it("discovers but omits contract-only packages from runtime Fibers", () => {
    const contract = plugin("counter.base", false);
    const tree = resolvePluginTree({
      profile: profile([{ id: contract.id }]),
      manifests: new Map([[contract.id, contract]]),
    });
    expect(tree.plugins).toEqual([]);
  });

  it("preserves stable row identity independently of package identity", () => {
    const replacement = plugin("company.counter-provider");
    const tree = resolvePluginTree({
      profile: profile([
        { id: "counter.provider", module: "@company/counter-provider" },
      ]),
      manifests: new Map([["counter.provider", replacement]]),
    });
    expect(tree.plugins[0]).toMatchObject({
      id: "counter.provider",
      manifest: { id: "company.counter-provider" },
      source: { type: "package", module: "@company/counter-provider" },
    });
  });

  it("omits disabled rows", () => {
    const disabled = plugin("disabled");
    expect(
      resolvePluginTree({
        profile: profile([{ id: disabled.id, enabled: false }]),
        manifests: new Map(),
      }).plugins,
    ).toEqual([]);
  });

  it("reports rows whose source manifest was not discovered", () => {
    expect(() =>
      resolvePluginTree({
        profile: profile([{ id: "missing" }]),
        manifests: new Map(),
      }),
    ).toThrow(PluginTreeResolutionError);
  });
});

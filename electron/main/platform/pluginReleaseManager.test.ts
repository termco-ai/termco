import { generateKeyPairSync, sign } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type {
  TermcoPluginManifestV3,
  TermcoProfileV3,
} from "../../../src/platform/contracts";
import {
  canonicalJson,
  pluginReleaseSignaturePayload,
  sha256Hex,
  type PluginCatalogManifest,
  type PluginReleaseManifest,
} from "./pluginRelease";
import {
  extractPluginReleaseArchive,
  PluginReleaseManager,
  preferBundledPluginBaseline,
  type PluginReleaseRuntimeHost,
} from "./pluginReleaseManager";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

function pluginManifest(
  version: string,
  id = "preview-surface-native",
): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: "Preview Surface",
    description: "Shows a live preview.",
    category: "Surfaces",
    version,
    entrypoints: { renderer: "src/renderer.tsx" },
    dependencies: {
      "@termco/kernel": "1.0.0",
      "@termco/ui": "1.0.0",
    },
  };
}

function archiveFor(...manifests: TermcoPluginManifestV3[]): Uint8Array {
  return zipSync(Object.fromEntries(manifests.flatMap((manifest) => [
    [`plugins/${manifest.id}/termco-plugin.json`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    [`plugins/${manifest.id}/package.json`, Buffer.from(`${JSON.stringify({ name: `@termco/plugin-${manifest.id}`, private: true, type: "module" })}\n`)],
    [`plugins/${manifest.id}/src/renderer.tsx`, Buffer.from("export default { activate() {} };\n")],
  ])));
}

function releaseFixture(input: {
  releaseId?: string;
  version?: string;
  revokedReleaseIds?: string[];
  archive?: Uint8Array;
  includeUnchanged?: boolean;
  catalog?: boolean;
  unchangedVersion?: string;
}) {
  const releaseId = input.releaseId ?? "plugins-2026.08.30.1";
  const version = input.version ?? "1.1.0";
  const unchanged = pluginManifest(
    input.unchangedVersion ?? "2.0.0",
    "unchanged-native",
  );
  const archive = input.archive ?? archiveFor(
    pluginManifest(version),
    ...(input.includeUnchanged ? [unchanged] : []),
  );
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const unsigned: Omit<PluginReleaseManifest, "signature"> = {
    schemaVersion: 1,
    releaseId,
    channel: "stable",
    publishedAt: "2026-08-30T12:00:00.000Z",
    application: { minVersion: "0.8.0", maxVersionExclusive: "0.9.0" },
    archive: {
      assetName: `${releaseId}.zip`,
      sha256: sha256Hex(archive),
      size: archive.byteLength,
    },
    plugins: [
      {
        id: "preview-surface-native",
        name: "Preview Surface",
        version,
        notes: "Improves preview refresh behavior.",
      },
      ...(input.includeUnchanged
        ? [{
            id: "unchanged-native",
            name: "Unchanged",
            version: unchanged.version,
            notes: "No changes.",
          }]
        : []),
    ],
    revokedReleaseIds: input.revokedReleaseIds ?? [],
    rolloutPercentage: 100,
  };
  const signature = sign(
    null,
    Buffer.from(pluginReleaseSignaturePayload(unsigned), "utf8"),
    privateKey,
  ).toString("base64");
  const artifacts = new Map(
    unsigned.plugins.map((plugin) => {
      const bytes = archiveFor(pluginManifest(plugin.version, plugin.id));
      return [plugin.id, bytes] as const;
    }),
  );
  const unsignedCatalog: Omit<PluginCatalogManifest, "signature"> = {
    schemaVersion: 2,
    releaseId,
    channel: "stable",
    publishedAt: unsigned.publishedAt,
    application: unsigned.application,
    plugins: unsigned.plugins.map((plugin) => {
      const bytes = artifacts.get(plugin.id) as Uint8Array;
      return {
        ...plugin,
        artifact: {
          assetName: `${plugin.id}-${plugin.version}.zip`,
          sha256: sha256Hex(bytes),
          size: bytes.byteLength,
        },
      };
    }),
    revokedReleaseIds: unsigned.revokedReleaseIds,
    rolloutPercentage: 100,
  };
  const catalog: PluginCatalogManifest | undefined = input.catalog
    ? {
        ...unsignedCatalog,
        signature: {
          algorithm: "ed25519",
          keyId: "production-1",
          value: sign(
            null,
            Buffer.from(canonicalJson(unsignedCatalog), "utf8"),
            privateKey,
          ).toString("base64"),
        },
      }
    : undefined;
  return {
    archive,
    artifacts,
    catalog,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    manifest: {
      ...unsigned,
      signature: {
        algorithm: "ed25519" as const,
        keyId: "production-1",
        value: signature,
      },
    },
  };
}

async function setup(input: {
  rowModule?: string;
  fixture?: ReturnType<typeof releaseFixture>;
  activation?: "replaced" | "cancelled";
  unchangedRowModule?: string;
}) {
  const root = await fs.mkdtemp(join(tmpdir(), "termco-plugin-release-test-"));
  temporaryRoots.push(root);
  const fixture = input.fixture ?? releaseFixture({});
  let profile: TermcoProfileV3 = {
    schemaVersion: 3,
    id: "termco.default",
    bundles: [],
    plugins: [
      {
        id: "preview-surface-native",
        module: input.rowModule ?? "bundled:plugin-repository/plugins/preview-surface-native",
      },
      ...(fixture.manifest.plugins.some((item) => item.id === "unchanged-native")
        ? [{
            id: "unchanged-native",
            module: input.unchangedRowModule ?? "official:/existing/unchanged-native",
          }]
        : []),
    ],
    patches: [],
  };
  let manifests = new Map([
    ["preview-surface-native", pluginManifest("1.0.0")],
    ...(fixture.manifest.plugins.some((item) => item.id === "unchanged-native")
      ? [["unchanged-native", pluginManifest("2.0.0", "unchanged-native")] as const]
      : []),
  ]);
  const activations: TermcoProfileV3[] = [];
  const compiledIds: string[] = [];
  const requestedUrls: string[] = [];
  const host: PluginReleaseRuntimeHost = {
    currentApplicationVersion: () => "0.8.2",
    snapshot: () => ({ profile, manifests }),
    async compile(pluginRoot, cacheRoot) {
      const manifest = JSON.parse(
        await fs.readFile(join(pluginRoot, "termco-plugin.json"), "utf8"),
      ) as TermcoPluginManifestV3;
      compiledIds.push(manifest.id);
      const output = join(cacheRoot, manifest.id, manifest.version);
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(join(output, "integrity.txt"), "sha256-test\n");
      await fs.writeFile(join(output, "renderer.mjs"), "export default {};\n");
      return { manifest, integrity: "sha256-test" };
    },
    async activate(candidate) {
      activations.push(structuredClone(candidate));
      if (input.activation === "cancelled") return { status: "cancelled" };
      profile = structuredClone(candidate);
      manifests = new Map(
        candidate.plugins.map((row) => [
          row.id,
          row.module.includes("preview-surface-native") && row.module.startsWith("official:")
            ? pluginManifest(fixture.manifest.plugins[0]!.version)
            : pluginManifest("1.0.0"),
        ]),
      );
      return { status: "replaced" };
    },
  };
  const fetchMock = async (inputValue: string | URL | Request) => {
    const url = String(inputValue);
    requestedUrls.push(url);
    if (url.endsWith("/releases/latest")) {
      return Response.json({
        tag_name: fixture.manifest.releaseId,
        draft: false,
        prerelease: false,
        assets: [
          {
            name: "termco-plugin-release.json",
            size: 1,
            browser_download_url: "https://download.test/manifest",
          },
          {
            name: fixture.manifest.archive.assetName,
            size: fixture.archive.byteLength,
            browser_download_url: "https://download.test/archive",
          },
          ...(fixture.catalog
            ? [
                {
                  name: "termco-plugin-catalog-v2.json",
                  size: 1,
                  browser_download_url: "https://download.test/catalog",
                },
                ...fixture.catalog.plugins.map((plugin) => ({
                  name: plugin.artifact.assetName,
                  size: plugin.artifact.size,
                  browser_download_url: `https://download.test/artifact/${plugin.id}`,
                })),
              ]
            : []),
        ],
      });
    }
    if (url.endsWith("/manifest")) return Response.json(fixture.manifest);
    if (url.endsWith("/catalog")) return Response.json(fixture.catalog);
    if (url.includes("/artifact/")) {
      const id = url.slice(url.lastIndexOf("/") + 1);
      const artifact = fixture.artifacts.get(id);
      return artifact ? new Response(artifact) : new Response("not found", { status: 404 });
    }
    if (url.endsWith("/archive")) return new Response(fixture.archive);
    return new Response("not found", { status: 404 });
  };
  const manager = new PluginReleaseManager({
    configuration: {
      enabled: true,
      repository: "termco-ai/termco-plugin-releases",
      publicKeys: { "production-1": fixture.publicKey },
    },
    paths: {
      stagingRoot: join(root, "staging"),
      officialPluginsRoot: join(root, "official"),
      cacheRoot: join(root, "cache"),
      stateFile: join(root, "state.json"),
    },
    host,
    fetch: fetchMock as typeof fetch,
  });
  return { root, fixture, manager, activations, compiledIds, requestedUrls };
}

describe("PluginReleaseManager", () => {
  it("checks and installs one signed atomic set into immutable official storage", async () => {
    const { root, fixture, manager, activations } = await setup({});
    const checked = await manager.check();
    expect(checked).toMatchObject({
      kind: "available",
      release: {
        releaseId: fixture.manifest.releaseId,
        plugins: [
          {
            id: "preview-surface-native",
            currentVersion: "1.0.0",
            version: "1.1.0",
          },
        ],
      },
    });
    await expect(manager.install(fixture.manifest.releaseId)).resolves.toMatchObject({
      status: "installed",
    });
    expect(activations).toHaveLength(1);
    expect(activations[0]?.plugins[0]?.module).toContain("official:");
    await expect(
      fs.readFile(
        join(
          root,
          "official",
          fixture.manifest.releaseId,
          "plugins",
          "preview-surface-native",
          "termco-plugin.json",
        ),
        "utf8",
      ),
    ).resolves.toContain('"version": "1.1.0"');
    await expect(
      fs.readFile(
        join(root, "cache", "preview-surface-native", "1.1.0", "integrity.txt"),
        "utf8",
      ),
    ).resolves.toBe("sha256-test\n");
  });

  it("shows and prepares only plugins whose installed version changed", async () => {
    const fixture = releaseFixture({ includeUnchanged: true, catalog: true });
    const { manager, compiledIds, activations, requestedUrls } = await setup({ fixture });

    await expect(manager.check()).resolves.toMatchObject({
      kind: "available",
      release: {
        plugins: [
          {
            id: "preview-surface-native",
            currentVersion: "1.0.0",
            version: "1.1.0",
          },
        ],
      },
    });
    await manager.install(fixture.manifest.releaseId);

    expect(compiledIds).toEqual(["preview-surface-native"]);
    expect(requestedUrls).toContain(
      "https://download.test/artifact/preview-surface-native",
    );
    expect(requestedUrls).not.toContain(
      "https://download.test/artifact/unchanged-native",
    );
    expect(requestedUrls).not.toContain("https://download.test/archive");
    expect(activations.at(-1)?.plugins.find((row) => row.id === "unchanged-native"))
      .toEqual({
        id: "unchanged-native",
        module: "official:/existing/unchanged-native",
      });
  });

  it("blocks the whole signed set when an official plugin was customized", async () => {
    const { manager, root } = await setup({
      rowModule: join(tmpdir(), "custom", "preview-surface-native"),
    });
    await expect(manager.check()).resolves.toMatchObject({
      kind: "blocked",
      reason: expect.stringContaining("customized"),
    });
    await expect(fs.stat(join(root, "official"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips a customized plugin while updating unrelated official plugins", async () => {
    const fixture = releaseFixture({
      includeUnchanged: true,
      unchangedVersion: "2.1.0",
      catalog: true,
    });
    const customSource = join(tmpdir(), "custom", "unchanged-native");
    const { manager, compiledIds, activations, requestedUrls } = await setup({
      fixture,
      unchangedRowModule: customSource,
    });

    await expect(manager.check()).resolves.toMatchObject({
      kind: "available",
      release: {
        plugins: [{ id: "preview-surface-native" }],
        skipped: [{
          id: "unchanged-native",
          reason: expect.stringContaining("customized source"),
        }],
      },
    });
    await manager.install(fixture.manifest.releaseId);

    expect(compiledIds).toEqual(["preview-surface-native"]);
    expect(requestedUrls).not.toContain(
      "https://download.test/artifact/unchanged-native",
    );
    expect(activations.at(-1)?.plugins.find((row) => row.id === "unchanged-native"))
      .toEqual({ id: "unchanged-native", module: customSource });
  });

  it("requires a fresh checked release before installation", async () => {
    const { manager } = await setup({});
    await expect(manager.install("plugins-2026.08.30.1")).rejects.toThrow(
      "checked and confirmed",
    );
  });

  it("leaves the active profile unchanged when live activation is cancelled", async () => {
    const { root, fixture, manager, activations } = await setup({
      activation: "cancelled",
    });
    await manager.check();
    await expect(manager.install(fixture.manifest.releaseId)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(activations).toHaveLength(1);
    await expect(
      fs.stat(join(root, "official", fixture.manifest.releaseId)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects archive traversal before writing outside staging", async () => {
    const archive = zipSync({ "../escaped.txt": Buffer.from("no") });
    const root = await fs.mkdtemp(join(tmpdir(), "termco-plugin-release-extract-"));
    temporaryRoots.push(root);
    await expect(extractPluginReleaseArchive(archive, join(root, "stage"))).rejects.toThrow(
      "escapes staging",
    );
    await expect(fs.stat(join(root, "escaped.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("automatically restores a fresh derived profile when the publisher revokes the active release", async () => {
    const fixture = releaseFixture({
      releaseId: "plugins-2026.08.30.2",
      version: "1.2.0",
      revokedReleaseIds: ["plugins-2026.08.30.1"],
    });
    const { root, manager, activations } = await setup({ fixture });
    const profileBefore: TermcoProfileV3 = {
      schemaVersion: 3,
      id: "termco.default",
      bundles: [],
      plugins: [
        {
          id: "preview-surface-native",
          module: "bundled:plugin-repository/plugins/preview-surface-native",
        },
      ],
      patches: [],
    };
    await fs.writeFile(
      join(root, "state.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        activeReleaseId: "plugins-2026.08.30.1",
        history: [
          {
            releaseId: "plugins-2026.08.30.1",
            installedAt: "2026-08-30T11:00:00.000Z",
            profileBefore,
            profileAfterId: "termco.release.previous",
            pluginIds: ["preview-surface-native"],
          },
        ],
      }, null, 2)}\n`,
    );

    await expect(manager.check()).resolves.toMatchObject({
      kind: "rolled-back",
      releaseId: "plugins-2026.08.30.1",
    });
    expect(activations).toHaveLength(1);
    expect(activations[0]?.id).toMatch(/^termco\.rollback\./);
    expect(activations[0]?.id).not.toBe("termco.default");
    expect(activations[0]?.plugins).toEqual(profileBefore.plugins);
    await expect(fs.readFile(join(root, "state.json"), "utf8")).resolves.not.toContain(
      '"activeReleaseId"',
    );
  });

  it("returns control to an equal or newer application-bundled generation", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "termco-plugin-baseline-test-"));
    temporaryRoots.push(root);
    const officialRoot = join(root, "official", "preview-surface-native");
    const bundledRoot = join(root, "plugins", "preview-surface-native");
    await Promise.all([
      fs.mkdir(officialRoot, { recursive: true }),
      fs.mkdir(bundledRoot, { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(
        join(officialRoot, "termco-plugin.json"),
        JSON.stringify(pluginManifest("1.1.0")),
      ),
      fs.writeFile(
        join(bundledRoot, "termco-plugin.json"),
        JSON.stringify(pluginManifest("1.1.0")),
      ),
    ]);
    const result = await preferBundledPluginBaseline({
      repositoryRoot: root,
      createProfileId: () => "termco.app-baseline.test",
      profile: {
        schemaVersion: 3,
        id: "termco.release.previous",
        bundles: [],
        plugins: [
          {
            id: "preview-surface-native",
            module: `official:${officialRoot}`,
          },
        ],
        patches: [],
      },
    });
    expect(result).toEqual({
      profile: {
        schemaVersion: 3,
        id: "termco.app-baseline.test",
        bundles: [],
        plugins: [
          {
            id: "preview-surface-native",
            module: "bundled:plugin-repository/plugins/preview-surface-native",
          },
        ],
        patches: [],
      },
      superseded: [
        { pluginId: "preview-surface-native", version: "1.1.0" },
      ],
    });
  });

  it("keeps a newer independent plugin generation after an application update", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "termco-plugin-baseline-test-"));
    temporaryRoots.push(root);
    const officialRoot = join(root, "official", "preview-surface-native");
    const bundledRoot = join(root, "plugins", "preview-surface-native");
    await Promise.all([
      fs.mkdir(officialRoot, { recursive: true }),
      fs.mkdir(bundledRoot, { recursive: true }),
    ]);
    await Promise.all([
      fs.writeFile(
        join(officialRoot, "termco-plugin.json"),
        JSON.stringify(pluginManifest("1.2.0")),
      ),
      fs.writeFile(
        join(bundledRoot, "termco-plugin.json"),
        JSON.stringify(pluginManifest("1.1.0")),
      ),
    ]);
    const module = `official:${officialRoot}`;
    const result = await preferBundledPluginBaseline({
      repositoryRoot: root,
      profile: {
        schemaVersion: 3,
        id: "termco.release.current",
        bundles: [],
        plugins: [{ id: "preview-surface-native", module }],
        patches: [],
      },
    });
    expect(result.superseded).toEqual([]);
    expect(result.profile.id).toBe("termco.release.current");
    expect(result.profile.plugins[0]?.module).toBe(module);
  });
});

import { generateKeyPairSync, sign } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { TermcoProfileV3 } from "../../../src/platform/contracts";
import {
  canonicalJson,
  sha256Hex,
} from "./pluginRelease";
import {
  assertCompleteInitialPluginRelease,
  installInitialPluginRelease,
  pluginBootstrapStatus,
  provisionedProfile,
  type PluginBootstrapPaths,
} from "./pluginBootstrap";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

function profile(id = "termco.default"): TermcoProfileV3 {
  return {
    schemaVersion: 3,
    id,
    bundles: [],
    plugins: [
      {
        id: "ui-shell-native",
        module: "bundled:core-plugins/ui-shell-native",
      },
      {
        id: "feature-native",
        module: "bundled:plugin-repository/plugins/feature-native",
      },
    ],
    patches: [],
  };
}

async function bootstrapPaths(root: string): Promise<PluginBootstrapPaths> {
  const paths: PluginBootstrapPaths = {
    repositoryRoot: root,
    profileTemplatesRoot: join(root, "templates"),
    userProfilesRoot: join(root, "user", "profiles"),
    activeProfileFile: join(root, "user", "active-profile.json"),
    completionFile: join(root, "user", "initial-setup.json"),
    stagingRoot: join(root, "user", "staging"),
    officialPluginsRoot: join(root, "user", "official"),
    cacheRoot: join(root, "user", "cache"),
    stateFile: join(root, "user", "plugin-releases.json"),
    configurationFile: join(root, "plugin-release.json"),
  };
  await Promise.all([
    fs.mkdir(join(paths.profileTemplatesRoot, "default"), { recursive: true }),
    fs.mkdir(join(paths.profileTemplatesRoot, "safe-recovery"), {
      recursive: true,
    }),
  ]);
  await Promise.all([
    fs.writeFile(
      join(paths.profileTemplatesRoot, "default", "profile.json"),
      JSON.stringify(profile()),
    ),
    fs.writeFile(
      join(paths.profileTemplatesRoot, "safe-recovery", "profile.json"),
      JSON.stringify(profile("termco.safe-recovery")),
    ),
  ]);
  return paths;
}

describe("initial plugin bootstrap", () => {
  it("requires the release to cover the complete non-protected profile", () => {
    expect(() => assertCompleteInitialPluginRelease(profile(), [])).toThrow(
      /missing: feature-native/,
    );
    expect(() =>
      assertCompleteInitialPluginRelease(profile(), [
        "feature-native",
        "surprise-native",
      ]),
    ).not.toThrow();
    expect(() =>
      assertCompleteInitialPluginRelease(profile(), ["feature-native"]),
    ).not.toThrow();
  });

  it("keeps protected modules bundled and points released modules at official source", () => {
    const result = provisionedProfile(
      profile(),
      new Map([["feature-native", "/official/plugins/feature-native"]]),
    );
    expect(result.plugins).toEqual([
      {
        id: "ui-shell-native",
        module: "bundled:core-plugins/ui-shell-native",
      },
      {
        id: "feature-native",
        module: "official:/official/plugins/feature-native",
      },
    ]);
  });

  it("pulls, verifies, prepares, and persists a signed initial plugin set", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "termco-bootstrap-"));
    temporaryRoots.push(root);
    const paths = await bootstrapPaths(root);

    const pluginManifest = {
      schemaVersion: 3 as const,
      id: "feature-native",
      name: "Feature",
      description: "Test feature",
      category: "Test",
      version: "1.0.0",
      entrypoints: { renderer: "src/renderer.ts" },
      dependencies: {},
      activation: "eager" as const,
    };
    const archive = zipSync({
      "plugins/feature-native/termco-plugin.json": new TextEncoder().encode(
        JSON.stringify(pluginManifest),
      ),
      "plugins/feature-native/src/renderer.ts": new TextEncoder().encode(
        "export default {};",
      ),
    });
    const releaseId = "plugins-0.9.0.1";
    const unsigned = {
      schemaVersion: 1 as const,
      releaseId,
      channel: "stable" as const,
      publishedAt: "2026-08-31T00:00:00.000Z",
      application: { minVersion: "0.9.0" },
      archive: {
        assetName: `${releaseId}.zip`,
        sha256: sha256Hex(archive),
        size: archive.byteLength,
      },
      plugins: [
        {
          id: "feature-native",
          name: "Feature",
          version: "1.0.0",
          notes: "Initial feature",
        },
      ],
      revokedReleaseIds: [],
      rolloutPercentage: 100 as const,
    };
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = {
      ...unsigned,
      signature: {
        algorithm: "ed25519" as const,
        keyId: "test-key",
        value: sign(
          null,
          Buffer.from(canonicalJson(unsigned)),
          privateKey,
        ).toString("base64"),
      },
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const fetchStub: typeof fetch = async (request) => {
      const url = String(request);
      if (url.endsWith("/repos/termco/test-feed/releases/latest")) {
        return Response.json({
          tag_name: releaseId,
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "termco-plugin-release.json",
              size: manifestBytes.byteLength,
              browser_download_url: "https://assets.test/manifest",
            },
            {
              name: `${releaseId}.zip`,
              size: archive.byteLength,
              browser_download_url: "https://assets.test/archive",
            },
          ],
        });
      }
      if (url === "https://assets.test/manifest") {
        return new Response(manifestBytes);
      }
      if (url === "https://assets.test/archive") {
        return new Response(archive);
      }
      return new Response("not found", { status: 404 });
    };
    const progress: string[] = [];
    const result = await installInitialPluginRelease({
      applicationVersion: "0.9.0",
      paths,
      configuration: {
        enabled: true,
        repository: "termco/test-feed",
        apiBaseUrl: "https://api.test",
        publicKeys: {
          "test-key": publicKey.export({ type: "spki", format: "pem" }).toString(),
        },
      },
      fetch: fetchStub,
      async compile(_pluginRoot, cacheRoot) {
        const output = join(cacheRoot, "feature-native", "1.0.0");
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(join(output, "integrity.txt"), "test-integrity\n");
        return { manifest: pluginManifest, integrity: "test-integrity" };
      },
      onProgress: (event) => progress.push(event.stage),
    });

    expect(result).toEqual({
      status: "installed",
      releaseId,
      pluginCount: 1,
    });
    expect(progress).toContain("verifying");
    expect(progress).toContain("preparing");
    expect(progress.at(-1)).toBe("activating");
    const installedProfile = JSON.parse(
      await fs.readFile(
        join(paths.userProfilesRoot, "default", "profile.json"),
        "utf8",
      ),
    ) as TermcoProfileV3;
    expect(installedProfile.plugins[1]?.module).toContain(
      `official:${join(paths.officialPluginsRoot, releaseId, "plugins", "feature-native")}`,
    );
    await expect(
      fs.access(join(paths.cacheRoot, "feature-native", "1.0.0", "integrity.txt")),
    ).resolves.toBeUndefined();
    await expect(
      pluginBootstrapStatus({
        applicationVersion: "0.9.0",
        repository: "termco/test-feed",
        paths,
      }),
    ).resolves.toEqual({ kind: "ready" });

    await expect(
      installInitialPluginRelease({
        applicationVersion: "0.9.0",
        paths,
        configuration: {
          enabled: true,
          repository: "termco/test-feed",
          apiBaseUrl: "https://api.test",
          publicKeys: {
            "test-key": publicKey.export({ type: "spki", format: "pem" }).toString(),
          },
        },
        fetch: fetchStub,
        async compile(_pluginRoot, cacheRoot) {
          const output = join(cacheRoot, "feature-native", "1.0.0");
          await fs.mkdir(output, { recursive: true });
          await fs.writeFile(join(output, "integrity.txt"), "test-integrity\n");
          return { manifest: pluginManifest, integrity: "test-integrity" };
        },
      }),
    ).resolves.toEqual({ status: "installed", releaseId, pluginCount: 1 });
  });

  it("recognizes a valid legacy installation when a release profile is active", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "termco-bootstrap-legacy-"));
    temporaryRoots.push(root);
    const paths = await bootstrapPaths(root);
    const releaseId = "plugins-0.9.0.8.1";
    const activeProfileId = "termco.release.1788203908163.b497806e";
    await Promise.all([
      fs.mkdir(join(paths.userProfilesRoot, activeProfileId), { recursive: true }),
      fs.mkdir(join(paths.officialPluginsRoot, releaseId, "plugins"), {
        recursive: true,
      }),
    ]);
    await Promise.all([
      fs.writeFile(
        join(paths.userProfilesRoot, activeProfileId, "profile.json"),
        JSON.stringify(profile(activeProfileId)),
      ),
      fs.writeFile(
        paths.activeProfileFile,
        JSON.stringify({ profileId: activeProfileId }),
      ),
      fs.writeFile(
        paths.stateFile,
        JSON.stringify({
          schemaVersion: 1,
          activeReleaseId: releaseId,
          history: [],
        }),
      ),
    ]);

    await expect(
      pluginBootstrapStatus({
        applicationVersion: "0.9.2",
        repository: "termco-ai/termco-plugin-releases",
        paths,
      }),
    ).resolves.toEqual({ kind: "ready" });
    await expect(fs.readFile(paths.completionFile, "utf8")).resolves.toContain(
      releaseId,
    );
  });
});

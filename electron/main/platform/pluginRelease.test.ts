import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertArchiveIntegrity,
  canonicalJson,
  compareStableVersions,
  isProtectedPlugin,
  parseAndVerifyPluginRelease,
  parseAndVerifyPluginCatalog,
  pluginReleaseSignaturePayload,
  sha256Hex,
  type PluginReleaseManifest,
  type PluginCatalogManifest,
} from "./pluginRelease";

function signedManifest(
  overrides: Partial<Omit<PluginReleaseManifest, "signature">> = {},
) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const archive = Buffer.from("release archive");
  const unsigned: Omit<PluginReleaseManifest, "signature"> = {
    schemaVersion: 1,
    releaseId: "plugins-2026.08.30.1",
    channel: "stable",
    publishedAt: "2026-08-30T12:00:00.000Z",
    application: { minVersion: "0.8.0", maxVersionExclusive: "0.9.0" },
    archive: {
      assetName: "termco-plugins-2026.08.30.1.zip",
      sha256: sha256Hex(archive),
      size: archive.byteLength,
    },
    plugins: [
      {
        id: "preview-surface-native",
        name: "Preview Surface",
        version: "1.1.0",
        notes: "Improves preview refresh behavior.",
      },
    ],
    revokedReleaseIds: [],
    rolloutPercentage: 100,
    ...overrides,
  };
  const signature = sign(
    null,
    Buffer.from(pluginReleaseSignaturePayload(unsigned), "utf8"),
    privateKey,
  ).toString("base64");
  return {
    archive,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    manifest: {
      ...unsigned,
      signature: { algorithm: "ed25519" as const, keyId: "production-1", value: signature },
    },
  };
}

describe("plugin release trust contract", () => {
  it("canonicalizes object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: [{ d: 4, c: 3 }] })).toBe(
      '{"a":[{"c":3,"d":4}],"z":1}',
    );
  });

  it("verifies a signed stable release and its application range", () => {
    const fixture = signedManifest();
    const result = parseAndVerifyPluginRelease(fixture.manifest, {
      currentApplicationVersion: "0.8.2",
      publicKeys: { "production-1": fixture.publicKey },
    });
    expect(result.compatible).toBe(true);
    expect(result.manifest.plugins.map(({ id }) => id)).toEqual([
      "preview-surface-native",
    ]);
    expect(() =>
      assertArchiveIntegrity(fixture.archive, result.manifest.archive),
    ).not.toThrow();
  });

  it("verifies independently downloadable plugin artifacts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const artifact = Buffer.from("one plugin");
    const unsigned: Omit<PluginCatalogManifest, "signature"> = {
      schemaVersion: 2,
      releaseId: "plugins-2026.09.01.1",
      channel: "stable",
      publishedAt: "2026-09-01T00:00:00.000Z",
      application: { minVersion: "0.9.3", maxVersionExclusive: "1.0.0" },
      plugins: [{
        id: "preview-surface-native",
        name: "Preview Surface",
        version: "1.1.0",
        notes: "Improves preview refresh behavior.",
        artifact: {
          assetName: "preview-surface-native-1.1.0.zip",
          sha256: sha256Hex(artifact),
          size: artifact.byteLength,
        },
      }],
      revokedReleaseIds: [],
      rolloutPercentage: 100,
    };
    const manifest: PluginCatalogManifest = {
      ...unsigned,
      signature: {
        algorithm: "ed25519",
        keyId: "production-1",
        value: sign(
          null,
          Buffer.from(canonicalJson(unsigned), "utf8"),
          privateKey,
        ).toString("base64"),
      },
    };

    expect(parseAndVerifyPluginCatalog(manifest, {
      currentApplicationVersion: "0.9.3",
      publicKeys: { "production-1": publicKey.export({ type: "spki", format: "pem" }).toString() },
    })).toMatchObject({
      compatible: true,
      manifest: {
        plugins: [{ artifact: { assetName: "preview-surface-native-1.1.0.zip" } }],
      },
    });
  });

  it("rejects tampered signed metadata", () => {
    const fixture = signedManifest();
    fixture.manifest.plugins[0]!.version = "1.2.0";
    expect(() =>
      parseAndVerifyPluginRelease(fixture.manifest, {
        currentApplicationVersion: "0.8.2",
        publicKeys: { "production-1": fixture.publicKey },
      }),
    ).toThrow("signature is invalid");
  });

  it("reports a valid release as incompatible outside its host range", () => {
    const fixture = signedManifest();
    expect(
      parseAndVerifyPluginRelease(fixture.manifest, {
        currentApplicationVersion: "0.9.0",
        publicKeys: { "production-1": fixture.publicKey },
      }).compatible,
    ).toBe(false);
  });

  it("rejects protected plugins and contract packages", () => {
    expect(isProtectedPlugin("updater-native")).toBe(true);
    expect(isProtectedPlugin("application-base")).toBe(true);
    expect(isProtectedPlugin("preview-surface-native")).toBe(false);
    const fixture = signedManifest({
      plugins: [
        {
          id: "safe-recovery-native",
          name: "Recovery",
          version: "1.1.0",
          notes: "Protected.",
        },
      ],
    });
    expect(() =>
      parseAndVerifyPluginRelease(fixture.manifest, {
        currentApplicationVersion: "0.8.2",
        publicKeys: { "production-1": fixture.publicKey },
      }),
    ).toThrow("requires an application update");
  });

  it("requires stable versions and immediate rollout", () => {
    const prerelease = signedManifest({
      plugins: [
        {
          id: "preview-surface-native",
          name: "Preview Surface",
          version: "1.1.0-beta.1",
          notes: "Beta.",
        },
      ],
    });
    expect(() =>
      parseAndVerifyPluginRelease(prerelease.manifest, {
        currentApplicationVersion: "0.8.2",
        publicKeys: { "production-1": prerelease.publicKey },
      }),
    ).toThrow("plugins[0].version is invalid");

    const partial = signedManifest({ rolloutPercentage: 50 as 100 });
    expect(() =>
      parseAndVerifyPluginRelease(partial.manifest, {
        currentApplicationVersion: "0.8.2",
        publicKeys: { "production-1": partial.publicKey },
      }),
    ).toThrow("100% rollout");
  });

  it("checks archive size and digest before extraction", () => {
    const fixture = signedManifest();
    expect(() =>
      assertArchiveIntegrity(Buffer.from("tampered archive"), fixture.manifest.archive),
    ).toThrow(/archive (size|digest) mismatch/);
  });

  it("compares stable application versions component-wise", () => {
    expect(compareStableVersions("0.8.2", "0.8.10")).toBe(-1);
    expect(compareStableVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareStableVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

export const PLUGIN_RELEASE_SCHEMA_VERSION = 1 as const;
export const PLUGIN_RELEASE_MANIFEST_ASSET = "termco-plugin-release.json";
export const PLUGIN_CATALOG_SCHEMA_VERSION = 2 as const;
export const PLUGIN_CATALOG_MANIFEST_ASSET = "termco-plugin-catalog-v2.json";

export const PROTECTED_PLUGIN_IDS = new Set([
  "boot-diagnostics-native",
  "plugin-manager-native",
  "safe-recovery-native",
  "settings-native",
  "ui-shell-native",
  "updater-native",
  "workspace-shell-native",
]);

const PLUGIN_ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]*[0-9A-Za-z])?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const KEY_ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]*[0-9A-Za-z])?$/;

export interface PluginReleaseItem {
  id: string;
  name: string;
  version: string;
  notes: string;
}

export interface PluginReleaseManifest {
  schemaVersion: typeof PLUGIN_RELEASE_SCHEMA_VERSION;
  releaseId: string;
  channel: "stable";
  publishedAt: string;
  application: {
    minVersion: string;
    maxVersionExclusive?: string;
  };
  archive: {
    assetName: string;
    sha256: string;
    size: number;
  };
  plugins: PluginReleaseItem[];
  revokedReleaseIds: string[];
  rolloutPercentage: 100;
  signature: {
    algorithm: "ed25519";
    keyId: string;
    value: string;
  };
}

export interface VerifiedPluginRelease {
  manifest: PluginReleaseManifest;
  compatible: boolean;
}

export interface PluginCatalogArtifact {
  assetName: string;
  sha256: string;
  size: number;
}

export interface PluginCatalogItem extends PluginReleaseItem {
  artifact: PluginCatalogArtifact;
}

export interface PluginCatalogManifest {
  schemaVersion: typeof PLUGIN_CATALOG_SCHEMA_VERSION;
  releaseId: string;
  channel: "stable";
  publishedAt: string;
  application: {
    minVersion: string;
    maxVersionExclusive?: string;
  };
  plugins: PluginCatalogItem[];
  revokedReleaseIds: string[];
  rolloutPercentage: 100;
  signature: {
    algorithm: "ed25519";
    keyId: string;
    value: string;
  };
}

export interface VerifiedPluginCatalog {
  manifest: PluginCatalogManifest;
  compatible: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unknown field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}`);
  }
}

function text(
  value: unknown,
  label: string,
  options: { max: number; pattern?: RegExp; allowEmpty?: boolean },
): string {
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && value.trim().length === 0) ||
    value.length > options.max ||
    (options.pattern && !options.pattern.test(value))
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function stableVersion(value: unknown, label: string): string {
  return text(value, label, { max: 40, pattern: STABLE_VERSION });
}

function parseReleaseItem(value: unknown, index: number): PluginReleaseItem {
  const item = record(value, `plugins[${index}]`);
  exactKeys(item, ["id", "name", "version", "notes"], `plugins[${index}]`);
  return {
    id: text(item.id, `plugins[${index}].id`, { max: 100, pattern: PLUGIN_ID }),
    name: text(item.name, `plugins[${index}].name`, { max: 160 }),
    version: stableVersion(item.version, `plugins[${index}].version`),
    notes: text(item.notes, `plugins[${index}].notes`, {
      max: 20_000,
      allowEmpty: true,
    }),
  };
}

function plainAssetName(value: unknown, label: string): string {
  const assetName = text(value, label, { max: 200 });
  if (
    assetName.includes("/") ||
    assetName.includes("\\") ||
    assetName === "." ||
    assetName === ".."
  ) {
    throw new Error(`${label} must be a plain file name`);
  }
  return assetName;
}

function parseArtifact(
  value: unknown,
  label: string,
  maximumSize: number,
): PluginCatalogArtifact {
  const artifact = record(value, label);
  exactKeys(artifact, ["assetName", "sha256", "size"], label);
  if (
    !Number.isSafeInteger(artifact.size) ||
    (artifact.size as number) <= 0 ||
    (artifact.size as number) > maximumSize
  ) {
    throw new Error(`${label}.size is outside the supported range`);
  }
  return {
    assetName: plainAssetName(artifact.assetName, `${label}.assetName`),
    sha256: text(artifact.sha256, `${label}.sha256`, {
      max: 64,
      pattern: SHA256,
    }),
    size: artifact.size as number,
  };
}

function parseCompatibility(value: unknown): {
  minVersion: string;
  maxVersionExclusive?: string;
} {
  const application = record(value, "application compatibility");
  exactKeys(
    application,
    ["minVersion", "maxVersionExclusive"],
    "application compatibility",
  );
  const minVersion = stableVersion(application.minVersion, "application.minVersion");
  const maxVersionExclusive = application.maxVersionExclusive === undefined
    ? undefined
    : stableVersion(
        application.maxVersionExclusive,
        "application.maxVersionExclusive",
      );
  if (
    maxVersionExclusive &&
    compareStableVersions(minVersion, maxVersionExclusive) >= 0
  ) {
    throw new Error("application compatibility range is empty");
  }
  return {
    minVersion,
    ...(maxVersionExclusive ? { maxVersionExclusive } : {}),
  };
}

function parseRevokedReleaseIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("revokedReleaseIds must be an array");
  }
  const releaseIds = value.map((entry, index) =>
    text(entry, `revokedReleaseIds[${index}]`, {
      max: 160,
      pattern: RELEASE_ID,
    }),
  );
  if (new Set(releaseIds).size !== releaseIds.length) {
    throw new Error("revokedReleaseIds contains duplicates");
  }
  return releaseIds;
}

function parseSignature(value: unknown): {
  signature: PluginReleaseManifest["signature"];
  bytes: Buffer;
} {
  const signature = record(value, "signature");
  exactKeys(signature, ["algorithm", "keyId", "value"], "signature");
  if (signature.algorithm !== "ed25519") {
    throw new Error("plugin release signature algorithm must be ed25519");
  }
  const keyId = text(signature.keyId, "signature.keyId", {
    max: 100,
    pattern: KEY_ID,
  });
  const signatureValue = text(signature.value, "signature.value", { max: 4096 });
  const bytes = Buffer.from(signatureValue, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== signatureValue) {
    throw new Error("signature.value is not a canonical Ed25519 signature");
  }
  return {
    signature: {
      algorithm: "ed25519",
      keyId,
      value: signatureValue,
    },
    bytes,
  };
}

function verifySignedManifest(
  signed: unknown,
  signature: PluginReleaseManifest["signature"],
  signatureBytes: Buffer,
  publicKeys: Readonly<Record<string, string>>,
): void {
  const publicKey = publicKeys[signature.keyId];
  if (!publicKey) {
    throw new Error(`plugin release signing key "${signature.keyId}" is not trusted`);
  }
  if (!verifySignature(
    null,
    Buffer.from(canonicalJson(signed), "utf8"),
    createPublicKey(publicKey),
    signatureBytes,
  )) {
    throw new Error("plugin release signature is invalid");
  }
}

function compatibleWithApplication(
  currentVersion: string,
  application: PluginReleaseManifest["application"],
): boolean {
  return compareStableVersions(currentVersion, application.minVersion) >= 0 &&
    (!application.maxVersionExclusive ||
      compareStableVersions(currentVersion, application.maxVersionExclusive) < 0);
}

export function isProtectedPlugin(pluginId: string): boolean {
  return PROTECTED_PLUGIN_IDS.has(pluginId) || pluginId.endsWith("-base");
}

export function compareStableVersions(left: string, right: string): number {
  if (!STABLE_VERSION.test(left) || !STABLE_VERSION.test(right)) {
    throw new Error("stable versions must use major.minor.patch");
  }
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("value is not JSON serializable");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function pluginReleaseSignaturePayload(
  value: Omit<PluginReleaseManifest, "signature">,
): string {
  return canonicalJson(value);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function assertArchiveIntegrity(
  bytes: Uint8Array,
  archive: PluginReleaseManifest["archive"] | PluginCatalogArtifact,
): void {
  if (bytes.byteLength !== archive.size) {
    throw new Error(
      `plugin release archive size mismatch: expected ${archive.size}, received ${bytes.byteLength}`,
    );
  }
  const digest = sha256Hex(bytes);
  if (digest !== archive.sha256) {
    throw new Error(
      `plugin release archive digest mismatch: expected ${archive.sha256}, received ${digest}`,
    );
  }
}

export function parseAndVerifyPluginCatalog(
  input: unknown,
  options: {
    currentApplicationVersion: string;
    publicKeys: Readonly<Record<string, string>>;
  },
): VerifiedPluginCatalog {
  const root = record(input, "plugin catalog manifest");
  exactKeys(
    root,
    [
      "schemaVersion",
      "releaseId",
      "channel",
      "publishedAt",
      "application",
      "plugins",
      "revokedReleaseIds",
      "rolloutPercentage",
      "signature",
    ],
    "plugin catalog manifest",
  );
  if (root.schemaVersion !== PLUGIN_CATALOG_SCHEMA_VERSION) {
    throw new Error(`unsupported plugin catalog schema ${String(root.schemaVersion)}`);
  }
  if (root.channel !== "stable") {
    throw new Error("only stable plugin releases are accepted");
  }
  if (root.rolloutPercentage !== 100) {
    throw new Error("plugin releases must use immediate 100% rollout");
  }
  if (!Array.isArray(root.plugins) || root.plugins.length === 0) {
    throw new Error("plugin catalog must contain at least one plugin");
  }

  const plugins = root.plugins.map((value, index): PluginCatalogItem => {
    const item = record(value, `plugins[${index}]`);
    exactKeys(
      item,
      ["id", "name", "version", "notes", "artifact"],
      `plugins[${index}]`,
    );
    const base = parseReleaseItem({
      id: item.id,
      name: item.name,
      version: item.version,
      notes: item.notes,
    }, index);
    return {
      ...base,
      artifact: parseArtifact(
        item.artifact,
        `plugins[${index}].artifact`,
        50 * 1024 * 1024,
      ),
    };
  });
  const ids = new Set<string>();
  const assetNames = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) throw new Error(`duplicate plugin release item "${plugin.id}"`);
    ids.add(plugin.id);
    if (assetNames.has(plugin.artifact.assetName)) {
      throw new Error(`duplicate plugin artifact "${plugin.artifact.assetName}"`);
    }
    assetNames.add(plugin.artifact.assetName);
    if (isProtectedPlugin(plugin.id)) {
      throw new Error(`protected plugin "${plugin.id}" requires an application update`);
    }
  }

  const application = parseCompatibility(root.application);
  const currentVersion = stableVersion(
    options.currentApplicationVersion,
    "current application version",
  );
  const publishedAt = text(root.publishedAt, "publishedAt", { max: 80 });
  if (!Number.isFinite(Date.parse(publishedAt))) {
    throw new Error("publishedAt must be an ISO date");
  }
  const parsedSignature = parseSignature(root.signature);
  const manifest: PluginCatalogManifest = {
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    releaseId: text(root.releaseId, "releaseId", {
      max: 160,
      pattern: RELEASE_ID,
    }),
    channel: "stable",
    publishedAt,
    application,
    plugins,
    revokedReleaseIds: parseRevokedReleaseIds(root.revokedReleaseIds),
    rolloutPercentage: 100,
    signature: parsedSignature.signature,
  };
  const { signature: _signature, ...signed } = manifest;
  verifySignedManifest(
    signed,
    manifest.signature,
    parsedSignature.bytes,
    options.publicKeys,
  );

  return {
    manifest,
    compatible: compatibleWithApplication(currentVersion, application),
  };
}

export function parseAndVerifyPluginRelease(
  input: unknown,
  options: {
    currentApplicationVersion: string;
    publicKeys: Readonly<Record<string, string>>;
  },
): VerifiedPluginRelease {
  const root = record(input, "plugin release manifest");
  exactKeys(
    root,
    [
      "schemaVersion",
      "releaseId",
      "channel",
      "publishedAt",
      "application",
      "archive",
      "plugins",
      "revokedReleaseIds",
      "rolloutPercentage",
      "signature",
    ],
    "plugin release manifest",
  );
  if (root.schemaVersion !== PLUGIN_RELEASE_SCHEMA_VERSION) {
    throw new Error(`unsupported plugin release schema ${String(root.schemaVersion)}`);
  }
  if (root.channel !== "stable") {
    throw new Error("only stable plugin releases are accepted");
  }
  if (root.rolloutPercentage !== 100) {
    throw new Error("plugin releases must use immediate 100% rollout");
  }

  const application = record(root.application, "application compatibility");
  exactKeys(
    application,
    ["minVersion", "maxVersionExclusive"],
    "application compatibility",
  );
  const archive = record(root.archive, "archive");
  exactKeys(archive, ["assetName", "sha256", "size"], "archive");
  const signature = record(root.signature, "signature");
  exactKeys(signature, ["algorithm", "keyId", "value"], "signature");
  if (signature.algorithm !== "ed25519") {
    throw new Error("plugin release signature algorithm must be ed25519");
  }

  if (!Array.isArray(root.plugins) || root.plugins.length === 0) {
    throw new Error("plugin release must contain at least one plugin");
  }
  const plugins = root.plugins.map(parseReleaseItem);
  const ids = new Set<string>();
  for (const plugin of plugins) {
    if (ids.has(plugin.id)) throw new Error(`duplicate plugin release item "${plugin.id}"`);
    ids.add(plugin.id);
    if (isProtectedPlugin(plugin.id)) {
      throw new Error(`protected plugin "${plugin.id}" requires an application update`);
    }
  }

  if (!Array.isArray(root.revokedReleaseIds)) {
    throw new Error("revokedReleaseIds must be an array");
  }
  const revokedReleaseIds = root.revokedReleaseIds.map((value, index) =>
    text(value, `revokedReleaseIds[${index}]`, {
      max: 160,
      pattern: RELEASE_ID,
    }),
  );
  if (new Set(revokedReleaseIds).size !== revokedReleaseIds.length) {
    throw new Error("revokedReleaseIds contains duplicates");
  }

  const size = archive.size;
  if (!Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > 250 * 1024 * 1024) {
    throw new Error("archive.size is outside the supported range");
  }
  const assetName = text(archive.assetName, "archive.assetName", { max: 200 });
  if (
    assetName.includes("/") ||
    assetName.includes("\\") ||
    assetName === "." ||
    assetName === ".."
  ) {
    throw new Error("archive.assetName must be a plain file name");
  }

  const minVersion = stableVersion(application.minVersion, "application.minVersion");
  const maxVersionExclusive = application.maxVersionExclusive === undefined
    ? undefined
    : stableVersion(
        application.maxVersionExclusive,
        "application.maxVersionExclusive",
      );
  if (
    maxVersionExclusive &&
    compareStableVersions(minVersion, maxVersionExclusive) >= 0
  ) {
    throw new Error("application compatibility range is empty");
  }
  const currentVersion = stableVersion(
    options.currentApplicationVersion,
    "current application version",
  );
  const publishedAt = text(root.publishedAt, "publishedAt", { max: 80 });
  if (!Number.isFinite(Date.parse(publishedAt))) {
    throw new Error("publishedAt must be an ISO date");
  }
  const keyId = text(signature.keyId, "signature.keyId", {
    max: 100,
    pattern: KEY_ID,
  });
  const signatureValue = text(signature.value, "signature.value", { max: 4096 });
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signatureValue, "base64");
  } catch {
    throw new Error("signature.value is not valid base64");
  }
  if (signatureBytes.length !== 64 || signatureBytes.toString("base64") !== signatureValue) {
    throw new Error("signature.value is not a canonical Ed25519 signature");
  }

  const manifest: PluginReleaseManifest = {
    schemaVersion: PLUGIN_RELEASE_SCHEMA_VERSION,
    releaseId: text(root.releaseId, "releaseId", {
      max: 160,
      pattern: RELEASE_ID,
    }),
    channel: "stable",
    publishedAt,
    application: {
      minVersion,
      ...(maxVersionExclusive ? { maxVersionExclusive } : {}),
    },
    archive: {
      assetName,
      sha256: text(archive.sha256, "archive.sha256", {
        max: 64,
        pattern: SHA256,
      }),
      size: size as number,
    },
    plugins,
    revokedReleaseIds,
    rolloutPercentage: 100,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: signatureValue,
    },
  };

  const publicKey = options.publicKeys[keyId];
  if (!publicKey) throw new Error(`plugin release signing key "${keyId}" is not trusted`);
  const { signature: _signature, ...signed } = manifest;
  const verified = verifySignature(
    null,
    Buffer.from(pluginReleaseSignaturePayload(signed), "utf8"),
    createPublicKey(publicKey),
    signatureBytes,
  );
  if (!verified) throw new Error("plugin release signature is invalid");

  return {
    manifest,
    compatible:
      compareStableVersions(currentVersion, minVersion) >= 0 &&
      (!maxVersionExclusive ||
        compareStableVersions(currentVersion, maxVersionExclusive) < 0),
  };
}

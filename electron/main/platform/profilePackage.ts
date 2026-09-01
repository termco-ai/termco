import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { TermcoProfileV3 } from "../../../src/platform/contracts";
import { parsePluginManifestV3 } from "../../../src/platform/manifest";
import { parseProfileV3 } from "../../../src/platform/profile";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 4_096;
const OMIT_DIRECTORIES = new Set([".git", ".termco-cache", "dist", "node_modules", "out"]);
const OMIT_FILES = new Set(["secrets.json", "termco-settings.json"]);
const PACKAGE_ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FIXED_MTIME = new Date("1980-01-01T00:00:00.000Z");
const MAX_DEFAULTS_BYTES = 1024 * 1024;

/** Preference keys whose owning settings features currently expose them as
 * portable profile defaults. Deliberately excludes credentials, recents,
 * onboarding progress, workspaces/rigs, OS autostart, and machine paths. */
export const PROFILE_DEFAULT_KEYS = [
  "restoreWindowState", "showHidden", "explorerGitDecorations",
  "agentNotifications", "agentAutoApprove", "richChatUi", "zoomLevel",
  "theme", "themeId", "editorTheme", "backgroundKind",
  "backgroundOpacity", "backgroundBlur", "appearance.customThemes",
  "vimMode", "editorWordWrap", "editorFormatOnSave", "editorAutoSave",
  "editorAutoSaveDelay", "terminalCursorBlink", "terminalFontFamily",
  "terminalFontWeight", "terminalLetterSpacing", "terminalFontSize",
  "terminalScrollback", "defaultModelId", "autocompleteEnabled",
  "autocompleteProvider", "autocompleteModelId", "compactionModelId",
  "compactThresholdTokens", "sttProvider", "groqSttModel",
  "whispercppBaseURL", "lmstudioBaseURL", "lmstudioModelId", "mlxBaseURL",
  "mlxModelId", "ollamaBaseURL", "ollamaModelId", "openrouterModelId",
  "customEndpoints", "shortcuts",
] as const;
const PROFILE_DEFAULT_KEY_SET = new Set<string>(PROFILE_DEFAULT_KEYS);

export interface ProfilePackagePluginSource {
  rowId: string;
  pluginId: string;
  version: string;
  root: string;
}

export interface ProfilePackageManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  termco: { minimumVersion: string };
  profile: "profile/profile.json";
  defaults: "profile/defaults.json";
  plugins: Array<{
    artifactId: string;
    pluginId: string;
    version: string;
    path: string;
    integrity: string;
  }>;
}

export interface CreateProfilePackageInput {
  id: string;
  name: string;
  description: string;
  version: string;
  termcoVersion: string;
  profile: TermcoProfileV3;
  defaults?: Readonly<Record<string, unknown>>;
  pluginSources: readonly ProfilePackagePluginSource[];
}

export interface ParsedProfilePackage {
  manifest: ProfilePackageManifest;
  profile: TermcoProfileV3;
  defaults: { schemaVersion: 1; values: Record<string, unknown> };
  files: ReadonlyMap<string, Uint8Array>;
}

function json(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function jsonValue(value: unknown, path: string, depth = 0): unknown {
  if (depth > 20) throw new Error(`${path} exceeds the nesting limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${path}.${index}`, depth + 1));
  if (!value || typeof value !== "object") throw new Error(`${path} is not JSON-compatible`);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`${path} contains an unsafe object key`);
    }
    result[key] = jsonValue(entry, `${path}.${key}`, depth + 1);
  }
  return result;
}

export function validateProfileDefaults(value: unknown): Record<string, unknown> {
  const raw = record(value, "profile defaults values");
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!PROFILE_DEFAULT_KEY_SET.has(key)) {
      throw new Error(`profile defaults contains unsupported preference "${key}"`);
    }
    result[key] = jsonValue(entry, `profile defaults.${key}`);
  }
  if (json(result).byteLength > MAX_DEFAULTS_BYTES) {
    throw new Error("profile defaults exceed the size limit");
  }
  return result;
}

function safeArchivePath(path: string): string {
  if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/")) {
    throw new Error(`unsafe archive path "${path}"`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`unsafe archive path "${path}"`);
  }
  if (segments.some((segment) => OMIT_DIRECTORIES.has(segment))) {
    throw new Error(`forbidden archive content "${path}"`);
  }
  if (OMIT_FILES.has(segments.at(-1) ?? "")) {
    throw new Error(`forbidden archive content "${path}"`);
  }
  return path;
}

async function sourceFiles(root: string): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) {
        throw new Error(`plugin source contains a symbolic link: ${join(directory, entry.name)}`);
      }
      if (entry.isDirectory()) {
        if (!OMIT_DIRECTORIES.has(entry.name)) await visit(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`plugin source contains a non-regular file: ${join(directory, entry.name)}`);
      }
      if (OMIT_FILES.has(entry.name)) continue;
      const file = join(directory, entry.name);
      const path = relative(root, file).replaceAll("\\", "/");
      safeArchivePath(path);
      const data = new Uint8Array(await fs.readFile(file));
      if (data.byteLength > MAX_FILE_BYTES) throw new Error(`plugin file is too large: ${path}`);
      bytes += data.byteLength;
      if (bytes > MAX_EXPANDED_BYTES) throw new Error("plugin sources exceed the profile package size limit");
      if (result.size >= MAX_ENTRIES) throw new Error("plugin sources exceed the profile package entry limit");
      result.set(path, data);
    }
  };
  await visit(root);
  return result;
}

function integrity(files: ReadonlyMap<string, Uint8Array>): string {
  const digest = createHash("sha256");
  for (const [path, data] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    digest.update(path);
    digest.update("\0");
    digest.update(data);
    digest.update("\0");
  }
  return `sha256-${digest.digest("hex")}`;
}

function validateExportInput(input: CreateProfilePackageInput): void {
  if (!PACKAGE_ID.test(input.id)) throw new Error("profile package id must be a lowercase namespaced id");
  if (!input.name.trim() || input.name.trim().length > 100) throw new Error("profile package name is invalid");
  if (input.description.length > 500) throw new Error("profile package description is too long");
  if (!VERSION.test(input.version)) throw new Error("profile package version must be semantic, for example 1.0.0");
  const parsed = parseProfileV3(input.profile);
  if (!parsed.ok) throw new Error(`active profile cannot be exported: ${parsed.error}`);
}

export async function createProfilePackage(
  input: CreateProfilePackageInput,
): Promise<{ bytes: Uint8Array; manifest: ProfilePackageManifest }> {
  validateExportInput(input);
  const defaults = validateProfileDefaults(input.defaults ?? {});
  const archive = new Map<string, Uint8Array>();
  const sourceByRow = new Map(input.pluginSources.map((source) => [source.rowId, source]));
  const artifacts: ProfilePackageManifest["plugins"] = [];
  const portableProfile: TermcoProfileV3 = {
    ...structuredClone(input.profile),
    id: input.id,
    plugins: [],
  };

  for (const row of input.profile.plugins) {
    const source = sourceByRow.get(row.id);
    if (!source) {
      if (!row.module.startsWith("bundled:")) {
        throw new Error(`profile row "${row.id}" has no portable plugin source`);
      }
      portableProfile.plugins.push({ ...row });
      continue;
    }
    const artifactId = source.pluginId;
    if (!PACKAGE_ID.test(artifactId)) throw new Error(`plugin id "${artifactId}" cannot be packaged`);
    const files = await sourceFiles(source.root);
    const manifestFile = files.get("termco-plugin.json");
    if (!manifestFile) throw new Error(`plugin "${source.pluginId}" has no termco-plugin.json`);
    const parsedManifest = parsePluginManifestV3(JSON.parse(strFromU8(manifestFile)) as unknown);
    if (!parsedManifest.ok) throw new Error(`plugin "${source.pluginId}" is invalid: ${parsedManifest.error}`);
    if (parsedManifest.manifest.id !== source.pluginId || parsedManifest.manifest.version !== source.version) {
      throw new Error(`plugin "${source.pluginId}" source metadata changed during export`);
    }
    for (const [path, data] of files) archive.set(`plugins/${artifactId}/${path}`, data);
    artifacts.push({
      artifactId,
      pluginId: source.pluginId,
      version: source.version,
      path: `plugins/${artifactId}`,
      integrity: integrity(files),
    });
    portableProfile.plugins.push({ ...row, module: `package:plugins/${artifactId}` });
  }

  const manifest: ProfilePackageManifest = {
    schemaVersion: 1,
    id: input.id,
    name: input.name.trim(),
    description: input.description.trim(),
    version: input.version,
    termco: { minimumVersion: input.termcoVersion },
    profile: "profile/profile.json",
    defaults: "profile/defaults.json",
    plugins: artifacts.sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
  };
  archive.set("profile/profile.json", json(portableProfile));
  archive.set("profile/defaults.json", json({ schemaVersion: 1, values: defaults }));
  archive.set("termco-profile.json", json(manifest));
  const zippable: Zippable = Object.fromEntries(
    [...archive].sort(([left], [right]) => left.localeCompare(right)).map(([path, data]) => [
      path,
      [data, { level: 6, mtime: FIXED_MTIME, os: 3, attrs: 0o644 << 16 }],
    ]),
  );
  const bytes = zipSync(zippable, { level: 6, mtime: FIXED_MTIME });
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("profile package exceeds the archive size limit");
  return { bytes, manifest };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`${label} contains unknown field "${unknown}"`);
}

function parseManifest(value: unknown): ProfilePackageManifest {
  const raw = record(value, "termco-profile.json");
  exactKeys(raw, ["schemaVersion", "id", "name", "description", "version", "termco", "profile", "defaults", "plugins"], "termco-profile.json");
  if (raw.schemaVersion !== 1) throw new Error("unsupported profile package schema");
  if (typeof raw.id !== "string" || !PACKAGE_ID.test(raw.id)) throw new Error("profile package id is invalid");
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 100) throw new Error("profile package name is invalid");
  if (typeof raw.description !== "string" || raw.description.length > 500) throw new Error("profile package description is invalid");
  if (typeof raw.version !== "string" || !VERSION.test(raw.version)) throw new Error("profile package version is invalid");
  if (raw.profile !== "profile/profile.json" || raw.defaults !== "profile/defaults.json") throw new Error("profile package document paths are invalid");
  const termco = record(raw.termco, "termco");
  exactKeys(termco, ["minimumVersion"], "termco");
  if (typeof termco.minimumVersion !== "string") throw new Error("minimum Termco version is invalid");
  if (!Array.isArray(raw.plugins)) throw new Error("profile package plugins must be an array");
  const seen = new Set<string>();
  const plugins = raw.plugins.map((value, index) => {
    const plugin = record(value, `plugins.${index}`);
    exactKeys(plugin, ["artifactId", "pluginId", "version", "path", "integrity"], `plugins.${index}`);
    if (
      typeof plugin.artifactId !== "string" || !PACKAGE_ID.test(plugin.artifactId) || seen.has(plugin.artifactId) ||
      typeof plugin.pluginId !== "string" || !PACKAGE_ID.test(plugin.pluginId) ||
      typeof plugin.version !== "string" || !VERSION.test(plugin.version) ||
      plugin.path !== `plugins/${plugin.artifactId}` ||
      typeof plugin.integrity !== "string" || !/^sha256-[a-f0-9]{64}$/.test(plugin.integrity)
    ) throw new Error(`profile package plugin ${index} is invalid`);
    seen.add(plugin.artifactId);
    return plugin as ProfilePackageManifest["plugins"][number];
  });
  return {
    schemaVersion: 1,
    id: raw.id,
    name: raw.name,
    description: raw.description,
    version: raw.version,
    termco: { minimumVersion: termco.minimumVersion },
    profile: "profile/profile.json",
    defaults: "profile/defaults.json",
    plugins,
  };
}

export function parseProfilePackage(bytes: Uint8Array): ParsedProfilePackage {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("profile package exceeds the archive size limit");
  let expanded = 0;
  let entries = 0;
  const caseFolded = new Set<string>();
  const unpacked = unzipSync(bytes, {
    filter(file) {
      const directory = file.name.endsWith("/");
      const name = directory ? file.name.slice(0, -1) : file.name;
      safeArchivePath(name);
      const folded = name.toLocaleLowerCase();
      if (caseFolded.has(folded)) throw new Error(`duplicate archive path "${name}"`);
      caseFolded.add(folded);
      entries += 1;
      if (entries > MAX_ENTRIES) throw new Error("profile package exceeds the entry limit");
      if (file.originalSize > MAX_FILE_BYTES) throw new Error(`profile package file is too large: ${name}`);
      expanded += file.originalSize;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error("profile package exceeds the expanded size limit");
      return !directory;
    },
  });
  const files = new Map(Object.entries(unpacked));
  const readJson = (path: string): unknown => {
    const data = files.get(path);
    if (!data) throw new Error(`profile package is missing ${path}`);
    try {
      return JSON.parse(strFromU8(data)) as unknown;
    } catch {
      throw new Error(`profile package contains invalid JSON at ${path}`);
    }
  };
  const manifest = parseManifest(readJson("termco-profile.json"));
  const parsedProfile = parseProfileV3(readJson(manifest.profile));
  if (!parsedProfile.ok) throw new Error(`profile package profile is invalid: ${parsedProfile.error}`);
  const defaultsRaw = record(readJson(manifest.defaults), "profile defaults");
  exactKeys(defaultsRaw, ["schemaVersion", "values"], "profile defaults");
  if (defaultsRaw.schemaVersion !== 1) throw new Error("profile defaults schema is invalid");
  const values = validateProfileDefaults(defaultsRaw.values);

  const artifactByPath = new Map(manifest.plugins.map((plugin) => [plugin.path, plugin]));
  for (const row of parsedProfile.profile.plugins) {
    if (row.module.startsWith("bundled:")) continue;
    if (!row.module.startsWith("package:")) throw new Error(`profile row "${row.id}" contains a non-portable module`);
    const path = row.module.slice("package:".length);
    if (!artifactByPath.has(path)) throw new Error(`profile row "${row.id}" references an undeclared artifact`);
  }
  for (const plugin of manifest.plugins) {
    const prefix = `${plugin.path}/`;
    const pluginFiles = new Map(
      [...files].filter(([path]) => path.startsWith(prefix)).map(([path, data]) => [path.slice(prefix.length), data]),
    );
    if (pluginFiles.size === 0) throw new Error(`profile package plugin "${plugin.artifactId}" has no files`);
    if (integrity(pluginFiles) !== plugin.integrity) throw new Error(`profile package plugin "${plugin.artifactId}" failed integrity validation`);
    const pluginManifestBytes = pluginFiles.get("termco-plugin.json");
    if (!pluginManifestBytes) throw new Error(`profile package plugin "${plugin.artifactId}" has no manifest`);
    const parsed = parsePluginManifestV3(JSON.parse(strFromU8(pluginManifestBytes)) as unknown);
    if (!parsed.ok || parsed.manifest.id !== plugin.pluginId || parsed.manifest.version !== plugin.version) {
      throw new Error(`profile package plugin "${plugin.artifactId}" metadata does not match its manifest`);
    }
  }
  return {
    manifest,
    profile: parsedProfile.profile,
    defaults: { schemaVersion: 1, values },
    files,
  };
}

export async function writeParsedProfilePackage(
  parsed: ParsedProfilePackage,
  directory: string,
): Promise<void> {
  for (const [path, data] of parsed.files) {
    safeArchivePath(path);
    const target = join(directory, ...path.split("/"));
    const contained = relative(directory, target);
    if (!contained || contained.startsWith("..") || isAbsolute(contained)) {
      throw new Error(`profile package path escapes installation root: ${path}`);
    }
    await fs.mkdir(join(target, ".."), { recursive: true });
    await fs.writeFile(target, data);
  }
}

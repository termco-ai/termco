import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const metadataFiles = {
  linux: "latest-linux.yml",
  macos: "latest-mac.yml",
  windows: "latest.yml",
};

export function updaterMetadataPath(platform, releaseRoot = "release") {
  const file = metadataFiles[platform];
  if (!file) throw new Error(`unsupported release platform: ${platform}`);
  return resolve(releaseRoot, file);
}

export async function verifyUpdaterMetadata(platform, releaseRoot = "release") {
  const file = updaterMetadataPath(platform, releaseRoot);
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`updater metadata is missing or empty: ${file}`);
  }

  const document = parse(await readFile(file, "utf8"));
  if (!Array.isArray(document?.files) || document.files.length === 0) {
    throw new Error(`updater metadata has no files: ${file}`);
  }

  for (const entry of document.files) {
    if (typeof entry?.url !== "string" || entry.url.length === 0) {
      throw new Error(`updater metadata contains an invalid file URL: ${file}`);
    }

    const decodedName = decodeURIComponent(entry.url.split(/[?#]/, 1)[0]);
    const artifactName = basename(decodedName);
    if (artifactName !== decodedName || artifactName === ".") {
      throw new Error(`updater metadata contains an unsafe file URL: ${entry.url}`);
    }

    const artifact = resolve(dirname(file), artifactName);
    let artifactStats;
    try {
      artifactStats = await stat(artifact);
    } catch {
      throw new Error(
        `updater artifact referenced by ${basename(file)} is missing: ${artifactName}`,
      );
    }
    if (!artifactStats.isFile() || artifactStats.size === 0) {
      throw new Error(
        `updater artifact referenced by ${basename(file)} is empty: ${artifactName}`,
      );
    }
  }

  return file;
}

async function main() {
  const platform = process.argv[2];
  const file = await verifyUpdaterMetadata(platform, process.argv[3]);
  console.log(`verified ${platform} updater metadata: ${file}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}

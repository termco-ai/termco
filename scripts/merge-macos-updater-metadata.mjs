import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";

function assertDocument(document, architecture) {
  if (typeof document?.version !== "string") {
    throw new Error(`${architecture} macOS updater metadata has no version`);
  }
  if (!Array.isArray(document.files) || document.files.length === 0) {
    throw new Error(`${architecture} macOS updater metadata has no files`);
  }
}

export function mergeMacUpdaterDocuments(x64, arm64) {
  assertDocument(x64, "x64");
  assertDocument(arm64, "arm64");
  if (x64.version !== arm64.version) {
    throw new Error(
      `macOS updater versions differ: x64=${x64.version}, arm64=${arm64.version}`,
    );
  }

  return {
    ...x64,
    files: [...x64.files, ...arm64.files],
  };
}

export async function mergeMacUpdaterMetadata(releaseRoot = "release") {
  const root = resolve(releaseRoot);
  const x64File = resolve(root, "latest-mac-x64.yml");
  const arm64File = resolve(root, "latest-mac-arm64.yml");
  const outputFile = resolve(root, "latest-mac.yml");
  const [x64, arm64] = await Promise.all([
    readFile(x64File, "utf8").then(parse),
    readFile(arm64File, "utf8").then(parse),
  ]);

  await writeFile(
    outputFile,
    stringify(mergeMacUpdaterDocuments(x64, arm64)),
  );
  await Promise.all([unlink(x64File), unlink(arm64File)]);
  return outputFile;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const output = await mergeMacUpdaterMetadata(process.argv[2]);
  console.log(`merged macOS updater metadata: ${output}`);
}

import { join } from "node:path";

const supportedPackages = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "win32-x64",
]);

export function packagedEsbuildBinary(
  resourcesPath,
  platform = process.platform,
  arch = process.arch,
) {
  const platformPackage = `${platform}-${arch}`;
  if (!supportedPackages.has(platformPackage)) {
    throw new Error(`unsupported packaged esbuild platform: ${platformPackage}`);
  }
  const binaryParts = platform === "win32" ? ["esbuild.exe"] : ["bin", "esbuild"];
  return join(
    resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@esbuild",
    platformPackage,
    ...binaryParts,
  );
}

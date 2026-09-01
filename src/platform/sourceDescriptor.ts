import type { ResolvedPluginSource } from "./contracts";

function fileUrlPath(module: string): string {
  const url = new URL(module);
  const decoded = decodeURIComponent(url.pathname);
  const localPath = /^\/[A-Za-z]:\//.test(decoded)
    ? decoded.slice(1)
    : decoded;
  return url.host ? `//${url.host}${localPath}` : localPath;
}

export function isAbsolutePluginLocation(location: string): boolean {
  return (
    location.startsWith("/") ||
    location.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(location)
  );
}

function normalizedLocation(location: string): string {
  return location.replaceAll("\\", "/").replace(/\/+$/, "");
}

export function isPluginLocationWithin(
  root: string,
  location: string,
): boolean {
  if (!isAbsolutePluginLocation(location)) return false;
  const normalizedRoot = normalizedLocation(root);
  const normalizedChild = normalizedLocation(location);
  return normalizedChild.startsWith(`${normalizedRoot}/`);
}

/** Browser-safe source identity shared by the renderer catalog and the
 * filesystem-backed main-process loader. */
export function describePluginSource(module: string): ResolvedPluginSource {
  if (module.startsWith("bundled:")) {
    return {
      type: "bundled",
      module,
      location: module.slice("bundled:".length),
    };
  }
  // Official plugin-only releases live outside the signed application bundle,
  // but remain immutable product code. Model them as bundled sources so the
  // Plugin Manager requires an explicit fork before editing them.
  if (module.startsWith("official:")) {
    return {
      type: "bundled",
      module,
      location: module.slice("official:".length),
    };
  }
  if (module.startsWith("file:")) {
    return { type: "file", module, location: fileUrlPath(module) };
  }
  if (
    isAbsolutePluginLocation(module) ||
    module.startsWith("./") ||
    module.startsWith("../")
  ) {
    return { type: "local", module, location: module, mutable: true };
  }
  return { type: "package", module, location: module };
}

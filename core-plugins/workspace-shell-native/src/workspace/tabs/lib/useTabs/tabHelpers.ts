/**
 * Small pure string helpers for deriving human-readable tab titles from paths
 * and URLs. Shared by the tab hook and the pure tab-planning ops.
 */

/** Last path segment of `path`, tolerant of both `/` and `\` separators. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** Host of a URL for use as a preview-tab title, falling back to the raw input. */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url || "preview";
  }
}


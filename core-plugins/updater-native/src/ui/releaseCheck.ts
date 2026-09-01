import type { HttpCapability } from "@termco/http-base";
import type { ManualUpdateInfo } from "./types";

const GITHUB_LATEST_RELEASE =
  "https://api.github.com/repos/termco-ai/termco/releases/latest";

export function parseVersion(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewer(remote: string, current: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(current);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkLinuxRelease(
  http: HttpCapability,
  currentVersion: string,
): Promise<ManualUpdateInfo | null> {
  const response = await http.request({
    url: GITHUB_LATEST_RELEASE,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub API ${response.status}`);
  }
  const data = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(response.body)),
  ) as {
    tag_name: string;
    body?: string;
    html_url: string;
  };
  const remote = data.tag_name.replace(/^v/, "");
  if (!isNewer(remote, currentVersion)) return null;
  return {
    version: remote,
    currentVersion,
    body: data.body ?? "",
    releaseUrl: data.html_url,
  };
}

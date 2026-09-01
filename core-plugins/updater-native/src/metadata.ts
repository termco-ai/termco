import type { UpdateMetadata } from "@termco/application-base";

export interface RawUpdateInfo {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | Array<unknown> | null;
}

export function toUpdateMetadata(
  info: RawUpdateInfo | null | undefined,
  currentVersion: string,
): UpdateMetadata | null {
  if (!info?.version || info.version === currentVersion) return null;
  return {
    available: true,
    version: info.version,
    currentVersion,
    ...(info.releaseDate ? { date: info.releaseDate } : {}),
    ...(typeof info.releaseNotes === "string" ? { body: info.releaseNotes } : {}),
  };
}

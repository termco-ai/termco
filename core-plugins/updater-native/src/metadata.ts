import type { UpdateMetadata } from "@termco/application-base";

export interface RawUpdateInfo {
  version?: string;
  releaseDate?: string;
  releaseNotes?: string | Array<unknown> | null;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
      if (named) return HTML_ENTITIES[named.toLowerCase()] ?? entity;
      const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", hexadecimal ? 16 : 10);
      try {
        return Number.isSafeInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    },
  );
}

/** electron-updater exposes GitHub release notes as HTML on macOS. The
 * renderer deliberately treats notes as text, so normalize semantic HTML
 * boundaries here instead of either leaking tags or introducing an HTML sink. */
export function releaseNotesToPlainText(value: string): string {
  const text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li(?:\s[^>]*)?>/gi, "• ")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|tr)\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    ...(typeof info.releaseNotes === "string"
      ? { body: releaseNotesToPlainText(info.releaseNotes) }
      : {}),
  };
}

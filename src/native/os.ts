/**
 * OS facts: `platform()`/`arch()` are resolved synchronously in preload
 * ("macos" | "windows" | "linux"), which drives src/lib/platform.ts.
 */
import { bridge } from "./bridge";

export type Platform =
  | "linux"
  | "macos"
  | "ios"
  | "freebsd"
  | "dragonfly"
  | "netbsd"
  | "openbsd"
  | "solaris"
  | "android"
  | "windows";

export function platform(): Platform {
  return bridge().os.platform as Platform;
}

export function arch(): string {
  return bridge().os.arch;
}

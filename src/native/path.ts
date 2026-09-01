/**
 * Path helpers: the app uses `homeDir`, `appConfigDir`, and `join`. Base dirs
 * are resolved once in the preload (platform-specific locations).
 */
import { bridge } from "./bridge";

export async function homeDir(): Promise<string> {
  return bridge().paths.home;
}

export async function appConfigDir(): Promise<string> {
  return bridge().paths.appConfig;
}

export async function appDataDir(): Promise<string> {
  return bridge().paths.appData;
}


/** Join + normalize (collapses `.`/`..`, single separators). */
export async function join(...parts: string[]): Promise<string> {
  const s = bridge().paths.sep;
  const joined = parts.join(s).split(/[\\/]+/);
  const out: string[] = [];
  for (const seg of joined) {
    if (seg === "" && out.length > 0) continue;
    if (seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join(s) || s;
}

/**
 * App metadata: `getName` / `getVersion` (About section + updater release check).
 */
import { bridge } from "./bridge";

export async function getName(): Promise<string> {
  return bridge().appInfo.name;
}

export async function getVersion(): Promise<string> {
  return bridge().appInfo.version;
}


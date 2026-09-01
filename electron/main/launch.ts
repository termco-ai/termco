/**
 * Product-neutral launch-directory parsing retained temporarily for the old
 * workspace adapter. The source-owned workspace provider owns the canonical
 * application value and exposes it through `workspace.registry.currentDir()`.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";

function computeLaunchDir(argv: string[]): string | null {
  // Skip the electron binary + main script; scan the rest for a directory.
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("-")) continue;
    try {
      const abs = resolve(arg);
      if (statSync(abs).isDirectory()) return abs;
    } catch {
      // not a path
    }
  }
  return null;
}

const computedLaunchDir: string | null = computeLaunchDir(process.argv);

/** Launch directory, or the process cwd as a fallback. */
export function resolveLaunchDir(): string {
  return computedLaunchDir ?? process.cwd();
}

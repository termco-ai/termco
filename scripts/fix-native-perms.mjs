/**
 * pnpm does not preserve the execute bit on node-pty's macOS `spawn-helper`
 * prebuild, which makes posix_spawnp fail at runtime. Restore +x on every
 * install. No-op on non-macOS / when the file is absent.
 */
import { chmodSync, existsSync } from "node:fs";
import { globSync } from "node:fs";

try {
  const matches = globSync(
    "node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/*/spawn-helper",
  );
  for (const file of matches) {
    if (existsSync(file)) {
      chmodSync(file, 0o755);
      console.log(`[fix-native-perms] chmod +x ${file}`);
    }
  }
} catch (e) {
  console.warn("[fix-native-perms] skipped:", e?.message ?? e);
}

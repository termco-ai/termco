import { createRequire } from "node:module";

/** Resolve the real Electron binary, never the package's child-spawning CLI. */
export const ELECTRON_EXECUTABLE = createRequire(import.meta.url)("electron");

export function spawnElectronProcess(spawn, environment, url) {
  return spawn(ELECTRON_EXECUTABLE, ["."], {
    stdio: "inherit",
    env: { ...environment, VITE_DEV_SERVER_URL: url },
    shell: process.platform === "win32",
  });
}

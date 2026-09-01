/**
 * Bundle the Electron main + preload TypeScript into dist-electron/*.cjs with
 * esbuild. Native/runtime deps stay external (resolved from node_modules at
 * runtime). Pass --watch for incremental rebuilds during development.
 */
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

// Kept external: Electron itself, native addons, and heavy runtime deps that
// must load from node_modules rather than be inlined.
const external = [
  "electron",
  "node-pty",
  "chokidar",
  "electron-updater",
  "@vscode/ripgrep",
  "undici",
];

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  sourcemap: true,
  external,
  logLevel: "info",
};

const entries = [
  {
    entryPoints: ["electron/main/index.ts"],
    outfile: "dist-electron/main/index.cjs",
  },
  {
    entryPoints: ["electron/preload/index.ts"],
    outfile: "dist-electron/preload/index.cjs",
  },
];

if (watch) {
  const ctxs = await Promise.all(
    entries.map((e) => context({ ...common, ...e })),
  );
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("[build-electron] watching…");
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
  console.log("[build-electron] done");
}

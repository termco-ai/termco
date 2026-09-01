/**
 * Dev orchestrator: start the Vite renderer dev server, build the Electron
 * main/preload (watch mode), wait for the server, then launch Electron pointed
 * at the dev URL. Ctrl-C tears everything down.
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { spawnElectronProcess } from "./dev-electron-process.mjs";
import { childIsRunning, stopDevStack } from "./dev-process-lifecycle.mjs";
import { resolveDevPort } from "./dev-port.mjs";

const VITE_PORT = resolveDevPort();
const VITE_URL = `http://localhost:${VITE_PORT}`;
const VITE_ENTRY = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);

const children = [];
function run(cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
  });
  children.push(child);
  return child;
}

// Electron is managed separately so we can restart just it on main-process
// rebuilds (the renderer hot-reloads via Vite, but main/preload changes need a
// fresh process — otherwise a fix in electron/main/* silently won't take effect).
let electron = null;
let restarting = false;
let shuttingDown = false;
let restartTimer = null;
const watchers = [];

function launchElectron() {
  electron = spawnElectronProcess(spawn, process.env, VITE_URL);
  electron.on("exit", () => {
    if (!restarting && !shuttingDown) void shutdown();
  });
}

function restartElectron() {
  if (!childIsRunning(electron)) return launchElectron();
  console.log("\n[dev] main/preload changed — restarting Electron…");
  restarting = true;
  electron.once("exit", () => {
    restarting = false;
    launchElectron();
  });
  electron.kill("SIGTERM");
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  restarting = false;
  if (restartTimer !== null) clearTimeout(restartTimer);
  for (const watcher of watchers) watcher.close();
  await stopDevStack(electron, children);
  process.exitCode = 0;
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

function waitForPort(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect(port, "localhost");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Vite dev server not up on :${port}`));
        } else {
          setTimeout(tryOnce, 250);
        }
      });
    };
    tryOnce();
  });
}

function waitForSuccessfulExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${label} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}`,
          ),
        );
      }
    });
  });
}

// A source-owned plugin is never allowed to run from yesterday's cache. Build
// every source folder before Vite or Electron can expose a UI. A compiler
// failure therefore stops dev at the real cause.
console.log("[dev] compiling source-owned plugin packages…");
await waitForSuccessfulExit(
  run(process.execPath, ["scripts/plugin-compiler.mjs"]),
  "plugin compilation",
);
// 1) Renderer dev server
// Run Vite directly. A nested `pnpm dev:renderer` reports its intentional
// SIGTERM as ELIFECYCLE 143 during shutdown even though the orchestrator exits
// successfully.
run(process.execPath, [VITE_ENTRY, "--port", String(VITE_PORT)]);
// 2) Electron bundle in watch mode
run("node", ["scripts/build-electron.mjs", "--watch"]);
// 2b) SSH remote-server bundle in watch mode (uploaded to remotes on connect)
run("node", ["scripts/build-server.mjs", "--watch"]);

// 3) Wait for Vite, then launch Electron
await waitForPort(VITE_PORT);
// Small settle so the esbuild watch has emitted dist-electron/* at least once.
await new Promise((r) => setTimeout(r, 800));

launchElectron();

// 4) Restart Electron whenever the main/preload bundle is rebuilt (debounced —
// esbuild emits the .cjs + .cjs.map together on each change).
const scheduleRestart = () => {
  if (shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(restartElectron, 350);
};
for (const dir of ["dist-electron/main", "dist-electron/preload"]) {
  try {
    watchers.push(watch(dir, { persistent: true }, scheduleRestart));
  } catch {
    // dir not ready yet — the initial build settle above usually prevents this
  }
}

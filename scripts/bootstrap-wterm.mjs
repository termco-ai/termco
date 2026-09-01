import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { commandInvocation } from "./platform-command.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wtermRoot = join(repositoryRoot, "vendor", "wterm");
const cacheFile = join(repositoryRoot, ".termco-cache", "wterm-bootstrap");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return "";
  return result.stdout.trim();
}

const manifest = join(wtermRoot, "package.json");
if (!existsSync(manifest)) {
  console.error(
    "Wterm is missing. Clone submodules with `git submodule update --init --recursive`.",
  );
  process.exit(1);
}

const revision = output("git", ["-C", wtermRoot, "rev-parse", "HEAD"]);
const outputs = [
  join(wtermRoot, "packages", "@wterm", "core", "dist", "index.js"),
  join(wtermRoot, "packages", "@wterm", "dom", "dist", "index.js"),
  join(wtermRoot, "packages", "@wterm", "ghostty", "dist", "index.js"),
];
const cachedRevision = existsSync(cacheFile)
  ? readFileSync(cacheFile, "utf8").trim()
  : "";

if (revision && revision === cachedRevision && outputs.every(existsSync)) {
  console.log(`Wterm ${revision.slice(0, 7)} is already built.`);
  process.exit(0);
}

run(pnpm, ["--dir", wtermRoot, "install", "--frozen-lockfile"]);
for (const packageName of ["@wterm/core", "@wterm/dom", "@wterm/ghostty"]) {
  run(pnpm, ["--dir", wtermRoot, "--filter", packageName, "build"]);
}

mkdirSync(dirname(cacheFile), { recursive: true });
writeFileSync(cacheFile, `${revision}\n`, { mode: 0o600 });
console.log(`Built Wterm ${revision.slice(0, 7)}.`);

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileAllPlugins } from "./plugin-compiler-lib.mjs";

export * from "./plugin-compiler-lib.mjs";

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = new Set(process.argv.slice(2));
  const supported = new Set(["--bundled", "--all"]);
  for (const arg of args) {
    if (!supported.has(arg)) {
      throw new Error(`unknown plugin compiler option: ${arg}`);
    }
  }
  if (args.has("--bundled") && args.has("--all")) {
    throw new Error("choose either --bundled or --all");
  }
  const scope = args.has("--all") ? "all" : "bundled";
  const directories = scope === "all"
    ? ["plugin-repository/plugins", "core-plugins"]
    : ["core-plugins"];
  const results = (
    await Promise.all(
      directories.map((directory) =>
        compileAllPlugins({
          pluginsRoot: join(repositoryRoot, directory),
          cacheRoot: join(repositoryRoot, ".termco-cache", "plugins"),
        }),
      ),
    )
  ).flat();
  console.log(`compiled ${results.length} ${scope} source-owning plugins`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}

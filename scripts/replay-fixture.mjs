import { build } from "esbuild";
import { resolve } from "node:path";

const entry = resolve(
  process.cwd(),
  "plugin-repository/plugins/ai-inference-replay-native/src/fixtureCli.ts",
);
const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  write: false,
  sourcemap: "inline",
  absWorkingDir: process.cwd(),
  tsconfig: resolve(process.cwd(), "tsconfig.plugins.json"),
});
const output = result.outputFiles[0];
if (!output) throw new Error("replay fixture CLI bundle was not produced");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.contents).toString("base64")}`;
const cli = await import(moduleUrl);
try {
  await cli.main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

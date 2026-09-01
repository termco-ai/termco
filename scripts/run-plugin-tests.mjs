import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { forwardedScriptArguments } from "./script-arguments.mjs";

const require = createRequire(import.meta.url);
const vitestCli = join(dirname(require.resolve("vitest")), "vitest.mjs");
const forwardedArguments = forwardedScriptArguments(process.argv.slice(2));
const child = spawn(
  process.execPath,
  [
    vitestCli,
    "run",
    "plugin-repository/plugins",
    ...forwardedArguments,
  ],
  {
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["inherit", "pipe", "pipe"],
  },
);

let stderr = "";

child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  stderr += text;
  process.stderr.write(chunk);
});

child.on("error", (error) => {
  console.error("Could not start the plugin test runner:", error);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (signal) {
    console.error(`Plugin tests terminated by ${signal}.`);
    process.exitCode = 1;
    return;
  }

  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }

  const unexpectedTestError =
    /(?:^|\n)stderr\s*\|/m.test(stderr) ||
    /CodeMirror plugin crashed|Unhandled Errors?/i.test(stderr);
  if (unexpectedTestError) {
    console.error(
      "Plugin tests wrote unexpected errors to stderr even though their assertions passed.",
    );
    process.exitCode = 1;
  }
});

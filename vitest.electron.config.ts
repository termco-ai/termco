import { defineConfig } from "vitest/config";
import { transformWithOxc } from "vite";
import path from "node:path";
import { loadTypeScriptWithoutMissingSourceMap } from "./src/test/viteTypeScript";

const pluginRepositoryRoot = /\/plugin-repository\/plugins\//;
const typedSource = /\.[cm]?[jt]sx?(?:\?.*)?$/;

// Backend (main-process) tests run in a Node environment. These are the ported
// Rust `#[test]` cases — the parity tier that proves the Node reimplementation
// matches the original backend behavior 1:1.
export default defineConfig({
  plugins: [
    loadTypeScriptWithoutMissingSourceMap(),
    {
      name: "termco:test-plugin-source",
      enforce: "pre",
      async transform(code, id) {
        if (!pluginRepositoryRoot.test(id) || !typedSource.test(id)) return null;
        return transformWithOxc(code, id, { tsconfig: false });
      },
    },
  ],
  oxc: {
    exclude: pluginRepositoryRoot,
  },
  resolve: {
    alias: [{
      find: /^@termco\/(.+-base)$/,
      replacement: path.resolve(
        __dirname,
        "plugin-repository/plugins/$1/src/index.ts",
      ),
    }],
  },
  test: {
    environment: "node",
    // server/ is the remote agent (bundled to resources/server) — its parsers
    // are plain node code and test in the same tier.
    include: [
      "electron/**/*.test.ts",
      "server/**/*.test.ts",
      // The bundled-plugin import rewriting is unit-tested: getting it wrong
      // fails silently at runtime inside a floating promise.
      "scripts/**/*.test.mjs",
    ],
  },
});

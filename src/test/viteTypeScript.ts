import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const typeScriptRuntime = /\/typescript\/lib\/typescript\.js$/;
const missingSourceMapReference =
  /\n?\/\/# sourceMappingURL=typescript\.js\.map\s*$/;

export function loadTypeScriptWithoutMissingSourceMap(): Plugin {
  return {
    name: "termco:test-typescript-source-map",
    enforce: "pre",
    load(id) {
      if (!typeScriptRuntime.test(id)) return null;
      return readFileSync(id, "utf8").replace(missingSourceMapReference, "");
    },
  };
}

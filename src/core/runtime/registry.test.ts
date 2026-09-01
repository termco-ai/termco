// @vitest-environment node
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_MODULES, runtimeModuleNames } from "./registry";

const root = resolve(import.meta.dirname, "../../..");
const IMPORT = /(?:from\s*|import\s*\()(["'])([^"']+)\1/g;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      if (/TestMock\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      return [path];
    }),
  );
  return nested.flat();
}

describe("renderer runtime module registry", () => {
  it("serves the generic kernel beside the existing public UI module", async () => {
    const available = runtimeModuleNames();
    expect(available).toContain("ui");
    expect(RUNTIME_MODULES.ui).toBeTypeOf("function");
    expect(available).toContain("kernel");

    const kernel = (await RUNTIME_MODULES.kernel()) as Record<string, unknown>;
    expect(kernel.processTransportService).toBe("kernel.process-transport");
    expect(kernel.CapabilityRuntime).toBeTypeOf("function");
  });

  for (const pluginId of ["git-surface", "ai-diff-surface", "ai-chat-native"]) {
    it(`serves every external module used by ${pluginId}`, async () => {
      const files = await sourceFiles(join(root, `plugin-repository/plugins/${pluginId}/src`));
      const specifiers = new Set<string>();
      for (const file of files) {
        const source = await fs.readFile(file, "utf8");
        for (const match of source.matchAll(IMPORT)) {
          const specifier = match[2];
          if (
            specifier.startsWith(".") ||
            specifier.startsWith("@termco/") ||
            specifier.startsWith("node:")
          ) {
            continue;
          }
          specifiers.add(specifier);
        }
      }
      const available = new Set(runtimeModuleNames());
      expect(
        [...specifiers].filter((specifier) => !available.has(specifier)),
      ).toEqual([]);
      if (pluginId !== "ai-chat-native") {
        expect(specifiers).toContain("@codemirror/merge");
      }
    });
  }
});

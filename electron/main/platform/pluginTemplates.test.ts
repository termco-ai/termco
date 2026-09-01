import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UI_CONTRIBUTION_AUTHORING_DESCRIPTORS } from "../../../plugin-repository/plugins/ui-shell-base/src/generated/authoringCatalog";
import type { PluginCreationTarget } from "../../../plugin-repository/plugins/profile-base/src/profileApi";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "termco-plugin-scaffolds-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("generated plugin scaffolds", () => {
  it("compiles every generated UI contract and provider-process target", async () => {
    const { scaffoldPlugin } = await import("./pluginTemplates");
    const { compileLivePlugin } = await import("./livePluginCompiler");
    const targets: PluginCreationTarget[] = [
      ...UI_CONTRIBUTION_AUTHORING_DESCRIPTORS.map((entry) => entry.service),
      "renderer-provider",
      "main-provider",
      "server",
    ];

    for (const [index, target] of targets.entries()) {
      const id = `generated-${index}-${target.replaceAll(".", "-")}`;
      const pluginRoot = join(root, id);
      const scaffold = scaffoldPlugin({
        id,
        name: `Generated ${target}`,
        description: `Compilation fixture for ${target}.`,
        category: "Generated test",
        target,
      });
      if (target === "ui.overlays") {
        expect(scaffold.files.get("src/renderer.ts")).toContain(
          '"data-termco-overlay": "true"',
        );
      }
      await mkdir(pluginRoot, { recursive: true });
      await writeFile(
        join(pluginRoot, "termco-plugin.json"),
        `${JSON.stringify(scaffold.manifest, null, 2)}\n`,
      );
      for (const [relativePath, source] of scaffold.files) {
        const file = join(pluginRoot, relativePath);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, source);
      }

      await expect(compileLivePlugin({
        repositoryRoot: process.cwd(),
        pluginRoot,
        cacheRoot: join(root, "cache"),
      }), target).resolves.toMatchObject({
        manifest: { id },
        integrity: expect.stringMatching(/^sha256-/),
      });
    }
  }, 60_000);
});

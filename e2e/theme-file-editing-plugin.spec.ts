import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("theme file editing is a source-owned live-replaceable background plugin", async ({ page, workspace }) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "theme-file-editing")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "theme-file-editing",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "theme-file-editing",
  );
  expect(profile.activationOrder).toContain("theme-file-editing");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "theme-file-editing",
    replacementId: "e2e.theme-file-editing",
  }));
  expect(result.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.theme-file-editing");
  const manifest = join(source, "termco-plugin.json");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "path.ts"))).toBe(true);
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace("Theme File Editing", "E2E Theme File Editing"),
  );

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.theme-file-editing"));
  expect(apply.status).toBe("replaced");
  const replaced = await page.evaluate(async () => (await window.__termco.rendererPluginProfile()).catalog);
  expect(replaced.find((entry) => entry.id === "e2e.theme-file-editing")?.name).toBe("E2E Theme File Editing (Custom)");
});

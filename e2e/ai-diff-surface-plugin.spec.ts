import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("AI diff review is a source-owned live-replaceable tab plugin", async ({ page, workspace }) => {
  const profile = await page.evaluate(() => window.__termco.rendererPluginProfile());
  expect(profile.plugins.find((entry) => entry.id === "ai-diff-surface"))
    .toMatchObject({
      id: "ai-diff-surface",
      manifest: {
        schemaVersion: 3,
        id: "ai-diff-surface",
        entrypoints: { renderer: "src/renderer.tsx" },
      },
    });
  expect(profile.activationOrder).toContain("ai-diff-surface");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-diff-surface" }),
  );

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "ai-diff-surface",
    replacementId: "e2e.ai-diff-surface",
  }));
  expect(result.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.ai-diff-surface");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "tabs.ts"))).toBe(true);
  expect(
    existsSync(join(source, "src", "baseline", "components", "AiDiffPane.tsx")),
  ).toBe(true);
  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace("AI Diff Review", "E2E AI Diff Review"),
  );

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.ai-diff-surface"));
  expect(apply.status).toBe("replaced");
  const replaced = await page.evaluate(async () => (await window.__termco.rendererPluginProfile()).catalog);
  expect(replaced.find((entry) => entry.id === "e2e.ai-diff-surface")?.name)
    .toBe("E2E AI Diff Review (Custom)");
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("Git AI tools consume the shared provider and replace live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.find((entry) => entry.id === "ai-tools-git-native"))
    .toMatchObject({
      id: "ai-tools-git-native",
      manifest: {
        schemaVersion: 3,
        id: "ai-tools-git-native",
        entrypoints: { renderer: "src/renderer.ts" },
      },
    });
  expect(profile.activationOrder).toContain("ai-tools-git-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-git-native" }),
  );

  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-git-native",
      replacementId: "e2e.ai-tools-git",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-tools-git",
  );
  expect(existsSync(join(source, "src", "renderer.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);
  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace("AI Tools: Git", "E2E AI Tools: Git"),
  );
  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-git"),
  );
  expect(apply.status).toBe("replaced");
  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(replaced.find((entry) => entry.id === "e2e.ai-tools-git")?.name).toBe(
    "E2E AI Tools: Git (Custom)",
  );
});

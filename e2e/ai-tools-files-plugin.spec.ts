import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("File AI tools consume the shared workspace provider and replace live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.find((entry) => entry.id === "ai-tools-files-native"))
    .toMatchObject({
      id: "ai-tools-files-native",
      manifest: {
        schemaVersion: 3,
        id: "ai-tools-files-native",
        entrypoints: { renderer: "src/index.ts" },
      },
    });
  expect(profile.activationOrder).toContain("ai-tools-files-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-files-native" }),
  );

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-files-native",
      replacementId: "e2e.ai-tools-files",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-tools-files",
  );
  expect(existsSync(join(source, "src", "index.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "security", "index.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "security", "patterns.ts"))).toBe(true);

  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace(
      "AI Tools: Files",
      "E2E AI Tools: Files",
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-files"),
  );
  expect(reloaded.status).toBe("replaced");

  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(
    replaced.find((entry) => entry.id === "e2e.ai-tools-files")?.name,
  ).toBe("E2E AI Tools: Files (Custom)");
});

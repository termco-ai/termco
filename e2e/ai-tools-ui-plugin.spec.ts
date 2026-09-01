import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("Rich UI AI tools are a whole-folder live-replaceable plugin", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.find((entry) => entry.id === "ai-tools-ui-native"))
    .toMatchObject({
      id: "ai-tools-ui-native",
      manifest: {
        schemaVersion: 3,
        id: "ai-tools-ui-native",
        entrypoints: { renderer: "src/index.ts" },
      },
    });
  expect(profile.activationOrder).toContain("ai-tools-ui-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-ui-native" }),
  );

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-ui-native",
      replacementId: "e2e.ai-tools-ui",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.ai-tools-ui");
  expect(existsSync(join(source, "src", "index.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "schema.ts"))).toBe(true);

  const implementation = readFileSync(join(source, "src", "tools.ts"), "utf8");
  expect(implementation).not.toContain("src/modules");
  expect(implementation).not.toContain("@/modules");

  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace(
      "AI Tools: Rich UI",
      "E2E AI Tools: Rich UI",
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-ui"),
  );
  expect(reloaded.status).toBe("replaced");

  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(replaced.find((entry) => entry.id === "e2e.ai-tools-ui")?.name)
    .toBe("E2E AI Tools: Rich UI (Custom)");
});

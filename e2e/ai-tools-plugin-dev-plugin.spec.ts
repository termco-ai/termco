import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("Plugin-development AI tools are source-owned and replace live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "ai-tools-plugin-dev-native"),
  ).toMatchObject({
    id: "ai-tools-plugin-dev-native",
    manifest: {
      schemaVersion: 3,
      id: "ai-tools-plugin-dev-native",
      entrypoints: { renderer: "src/index.ts" },
    },
  });
  expect(profile.activationOrder).toContain("ai-tools-plugin-dev-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-plugin-dev-native" }),
  );

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-plugin-dev-native",
      replacementId: "e2e.ai-tools-plugin-dev",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-tools-plugin-dev",
  );
  expect(existsSync(join(source, "src", "index.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);
  const implementation = readFileSync(join(source, "src", "tools.ts"), "utf8");
  expect(implementation).not.toContain("plugin-host");
  expect(implementation).not.toContain("@/src");

  const sourceFiles = await page.evaluate(() =>
    window.__termco.listPluginSourceFiles("e2e.ai-tools-plugin-dev"),
  );
  expect(sourceFiles).toContain("src/tools.ts");
  await page.evaluate(() =>
    window.__termco.writePluginSourceFile(
      "e2e.ai-tools-plugin-dev",
      "README.md",
      "# Edited through the jailed profile source API\n",
    ),
  );
  await expect(page.evaluate(() =>
    window.__termco.readPluginSourceFile(
      "e2e.ai-tools-plugin-dev",
      "README.md",
    ),
  )).resolves.toContain("jailed profile source API");
  await expect(page.evaluate(() =>
    window.__termco.readPluginSourceFile(
      "e2e.ai-tools-plugin-dev",
      "../outside.txt",
    ),
  )).rejects.toThrow(/escapes the plugin folder/);

  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace(
      "AI Tools: Plugin Development",
      "E2E AI Tools: Plugin Development",
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-plugin-dev"),
  );
  expect(reloaded.status).toBe("replaced");
  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(
    replaced.find((entry) => entry.id === "e2e.ai-tools-plugin-dev")?.name,
  ).toBe("E2E AI Tools: Plugin Development (Custom)");
});

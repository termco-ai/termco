import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("Browser AI tools consume the shared browser runtime and replace live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.find((entry) => entry.id === "ai-tools-browser-native"))
    .toMatchObject({
      id: "ai-tools-browser-native",
      manifest: {
        schemaVersion: 3,
        id: "ai-tools-browser-native",
        entrypoints: { renderer: "src/index.ts" },
      },
    });
  expect(profile.activationOrder).toContain("ai-tools-browser-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-browser-native" }),
  );

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-browser-native",
      replacementId: "e2e.ai-tools-browser",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-tools-browser",
  );
  expect(existsSync(join(source, "src", "index.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);

  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace(
      "AI Tools: Browser",
      "E2E AI Tools: Browser",
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-browser"),
  );
  expect(reloaded.status).toBe("replaced");

  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(
    replaced.find((entry) => entry.id === "e2e.ai-tools-browser")?.name,
  ).toBe("E2E AI Tools: Browser (Custom)");
});

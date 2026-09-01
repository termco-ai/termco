import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("Container and port AI tools share application-wide providers and replace live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "ai-tools-containers-native"),
  ).toMatchObject({
    id: "ai-tools-containers-native",
    manifest: {
      schemaVersion: 3,
      id: "ai-tools-containers-native",
      entrypoints: { renderer: "src/index.ts" },
    },
  });
  expect(profile.activationOrder).toContain("ai-tools-containers-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-containers-native" }),
  );

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-containers-native",
      replacementId: "e2e.ai-tools-containers",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-tools-containers",
  );
  expect(existsSync(join(source, "src", "index.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);

  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace(
      "AI Tools: Containers & Ports",
      "E2E AI Tools: Containers & Ports",
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-containers"),
  );
  expect(reloaded.status).toBe("replaced");

  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(
    replaced.find((entry) => entry.id === "e2e.ai-tools-containers")?.name,
  ).toBe("E2E AI Tools: Containers & Ports (Custom)");
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("Terminal AI tools consume the shared shell runtime and replace live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "ai-tools-terminal-native"),
  ).toMatchObject({
    id: "ai-tools-terminal-native",
    manifest: {
      schemaVersion: 3,
      id: "ai-tools-terminal-native",
      entrypoints: { renderer: "src/index.ts" },
    },
  });
  expect(profile.activationOrder).toContain("ai-tools-terminal-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-terminal-native" }),
  );

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-terminal-native",
      replacementId: "e2e.ai-tools-terminal",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-tools-terminal",
  );
  expect(existsSync(join(source, "src", "index.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "security.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "truncate.ts"))).toBe(true);

  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace(
      "AI Tools: Terminal",
      "E2E AI Tools: Terminal",
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-terminal"),
  );
  expect(reloaded.status).toBe("replaced");

  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(
    replaced.find((entry) => entry.id === "e2e.ai-tools-terminal")?.name,
  ).toBe("E2E AI Tools: Terminal (Custom)");
});

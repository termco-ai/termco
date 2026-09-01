import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("Managed-agent AI tools replace as a whole source folder", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find(
      (entry) => entry.id === "ai-tools-managed-agents-native",
    ),
  ).toMatchObject({
    id: "ai-tools-managed-agents-native",
    manifest: {
      schemaVersion: 3,
      id: "ai-tools-managed-agents-native",
      entrypoints: { renderer: "src/index.ts" },
    },
  });
  expect(profile.activationOrder).toContain("ai-tools-managed-agents-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "ai-tools-managed-agents-native" }),
  );

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-tools-managed-agents-native",
      replacementId: "e2e.ai-tools-managed-agents",
    }),
  );
  expect(copied.status).toBe("replaced");
  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-tools-managed-agents",
  );
  expect(existsSync(join(source, "src", "tools.ts"))).toBe(true);
  const implementation = readFileSync(join(source, "src", "tools.ts"), "utf8");
  expect(implementation).not.toContain("managedAgentsStore");
  expect(implementation).not.toContain("@/modules");

  const manifest = join(source, "termco-plugin.json");
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace(
      "AI Tools: Managed Coding Agents",
      "E2E AI Tools: Managed Coding Agents",
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-tools-managed-agents"),
  );
  expect(reloaded.status).toBe("replaced");
  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(replaced.find(
    (entry) => entry.id === "e2e.ai-tools-managed-agents",
  )?.name).toBe("E2E AI Tools: Managed Coding Agents (Custom)");
});

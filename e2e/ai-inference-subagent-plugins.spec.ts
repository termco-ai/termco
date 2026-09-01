import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

test("inference and subagent implementations are independent live-replaceable source plugins", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  for (const [pluginId, renderer] of [
    ["ai-inference-native", "src/index.ts"],
    ["ai-tools-subagents-native", "src/index.ts"],
  ] as const) {
    expect(profile.plugins.find((entry) => entry.id === pluginId)).toMatchObject({
      id: pluginId,
      manifest: {
        schemaVersion: 3,
        id: pluginId,
        entrypoints: { renderer },
      },
    });
    expect(profile.activationOrder).toContain(pluginId);
    expect(profile.modules).toContainEqual(
      expect.objectContaining({ pluginId }),
    );
  }

  for (const item of [
    {
      pluginId: "ai-inference-native",
      replacementId: "e2e.ai-inference",
      oldName: "AI Inference",
      newName: "E2E AI Inference",
      sourceFile: "src/model.ts",
    },
    {
      pluginId: "ai-tools-subagents-native",
      replacementId: "e2e.ai-tools-subagents",
      oldName: "AI Tools: Subagents",
      newName: "E2E AI Tools: Subagents",
      sourceFile: "src/tools.ts",
    },
  ]) {
    const copied = await page.evaluate((request) =>
      window.__termcoE2E.copyAndReplacePluginThroughPlan(request), {
        pluginId: item.pluginId,
        replacementId: item.replacementId,
      },
    );
    expect(copied.status).toBe("replaced");
    const source = join(workspace.userData, "plugin-platform", "plugins", item.replacementId);
    expect(existsSync(join(source, item.sourceFile))).toBe(true);
    const implementation = readFileSync(join(source, item.sourceFile), "utf8");
    expect(implementation).not.toContain("@/modules");
    expect(implementation).not.toContain("useChatStore");

    const manifest = join(source, "termco-plugin.json");
    writeFileSync(
      manifest,
      readFileSync(manifest, "utf8").replace(item.oldName, item.newName),
    );
    const reloaded = await page.evaluate((pluginId) =>
      window.__termco.applyPlugin(pluginId), item.replacementId,
    );
    expect(reloaded.status).toBe("replaced");
  }

  const replaced = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(replaced.find((entry) => entry.id === "e2e.ai-inference")?.name)
    .toBe("E2E AI Inference (Custom)");
  expect(replaced.find((entry) => entry.id === "e2e.ai-tools-subagents")?.name)
    .toBe("E2E AI Tools: Subagents (Custom)");
});

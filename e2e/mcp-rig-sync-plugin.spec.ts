import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace mcp-rig-sync source=src/model.ts runtime=E2E_synced_rig_name
test("MCP workspace mirroring is a source-owned consumer of the shared server", async ({ page, workspace }) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "mcp-rig-sync")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "mcp-rig-sync",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "mcp-rig-sync",
  );
  expect(profile.activationOrder).toContain("mcp-rig-sync");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "mcp-rig-sync",
    replacementId: "e2e.mcp-rig-sync",
  }));
  expect(result.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.mcp-rig-sync");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  const model = join(source, "src", "model.ts");
  expect(existsSync(model)).toBe(true);
  const original = readFileSync(model, "utf8");
  const edited = original.replace(
    "name: rig.name",
    "name: `E2E ${rig.name}`",
  );
  expect(edited).not.toBe(original);
  writeFileSync(model, edited);

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.mcp-rig-sync"));
  expect(apply.status).toBe("replaced");
  await expect.poll(async () => {
    const rigs = await page.evaluate(() => window.__termco.capabilityCall({
      consumerPluginId: "mcp-tool-bridge",
      capability: "mcp.server",
      method: "invoke",
      args: ["mcp_rigs_list", {}],
    }));
    return (rigs as Array<{ name: string }>).map((rig) => rig.name);
  }).toEqual(expect.arrayContaining([expect.stringMatching(/^E2E /)]));
  await expectWholeFolderReplacementSelected(
    page,
    "mcp-rig-sync",
    "e2e.mcp-rig-sync",
  );

  await revertWholeFolderReplacement(page, "mcp-rig-sync", "e2e.mcp-rig-sync");
  await expect.poll(async () => {
    const rigs = await page.evaluate(() => window.__termco.capabilityCall({
      consumerPluginId: "mcp-tool-bridge",
      capability: "mcp.server",
      method: "invoke",
      args: ["mcp_rigs_list", {}],
    }));
    return (rigs as Array<{ name: string }>).map((rig) => rig.name);
  }).toEqual(expect.not.arrayContaining([expect.stringMatching(/^E2E /)]));
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

// @termco-certifies copy-replace mcp-tool-bridge source=src/renderer.tsx runtime=e2e.mcp-tool-bridge
test("the MCP renderer bridge is source-owned and replaces live", async ({
  page,
  workspace,
}) => {
  const bridge = page.getByTestId("mcp-tool-bridge-source");
  await expect(bridge).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await expect(bridge).toHaveAttribute("data-source-plugin", "mcp-tool-bridge");
  const serverReplacement = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "mcp-server-native",
      replacementId: "e2e.mcp-server-native",
    }),
  );
  expect(serverReplacement.status).toBe("replaced");
  await expect(bridge).toHaveAttribute("data-status", "active");

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "mcp-tool-bridge")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "mcp-tool-bridge",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "mcp-tool-bridge",
  );
  expect(profile.activationOrder).toContain("mcp-tool-bridge");

  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "mcp-tool-bridge",
      replacementId: "e2e.mcp-tool-bridge",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.mcp-tool-bridge",
  );
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "bridge.ts"))).toBe(true);
  writeFileSync(
    renderer,
    readFileSync(renderer, "utf8").replace(
      'data-source-plugin="mcp-tool-bridge"',
      'data-source-plugin="e2e.mcp-tool-bridge"',
    ),
  );

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.mcp-tool-bridge"),
  );
  expect(apply.status).toBe("replaced");
  const replacement = page.getByTestId("mcp-tool-bridge-source");
  await expect(replacement).toHaveAttribute(
    "data-source-plugin",
    "e2e.mcp-tool-bridge",
  );
  await page.waitForTimeout(500);
  await expect(replacement).toHaveAttribute("data-status", "active");
  await expectWholeFolderReplacementSelected(
    page,
    "mcp-tool-bridge",
    "e2e.mcp-tool-bridge",
  );

  await revertWholeFolderReplacement(
    page,
    "mcp-tool-bridge",
    "e2e.mcp-tool-bridge",
  );
  await expect(bridge).toHaveAttribute("data-source-plugin", "mcp-tool-bridge");
  await expect(bridge).toHaveAttribute("data-status", "active");

  await revertWholeFolderReplacement(
    page,
    "mcp-server-native",
    "e2e.mcp-server-native",
  );
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, MOD, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace agents-manager-native source=src/plugin.tsx runtime=Manage_E2E_agent_library
test("Agents Manager is source-owned and replaces live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  const manager = profile.plugins.find(
    (plugin) => plugin.id === "agents-manager-native",
  );
  expect(manager).toMatchObject({
    id: "agents-manager-native",
    manifest: {
      schemaVersion: 3,
      id: "agents-manager-native",
      entrypoints: { renderer: "src/plugin.tsx" },
    },
  });
  expect(profile.activationOrder).toContain("agents-manager-native");
  expect(profile.modules).toContainEqual(
    expect.objectContaining({ pluginId: "agents-manager-native" }),
  );

  const library = (await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "agents-manager-native",
      capability: "ai.library",
      method: "snapshot",
      args: [],
    }),
  )) as { agents: Array<{ id: string }> };
  expect(library.agents.map((agent) => agent.id)).toContain("builtin:coder");

  await page.keyboard.press(`${MOD}+p`);
  const activePalette = page.getByRole("dialog").first();
  await page.keyboard.type("Manage agents snippets skills MCP servers");
  await expect(
    activePalette.getByRole("option", {
      name: "Manage agents, snippets, skills, and MCP servers",
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Agents & Snippets/ }).first().click();
  const activeManager = page.getByTestId("agents-manager");
  await expect(activeManager).toBeVisible();
  await expect(activeManager.locator("xpath=..")).toHaveAttribute(
    "data-source-plugin",
    "agents-manager-native",
  );
  await page.keyboard.press("Escape");
  await expect(activeManager).toBeHidden();

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "agents-manager-native",
      replacementId: "e2e.agents-manager-native",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.agents-manager-native",
  );
  const entry = join(source, "src", "plugin.tsx");
  expect(existsSync(entry)).toBe(true);
  expect(existsSync(join(source, "src", "AgentsManagerView.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "components", "AgentEditorDialog.tsx"))).toBe(true);
  const implementation = readFileSync(entry, "utf8");
  expect(implementation).not.toContain("@/modules");
  expect(implementation).not.toContain("@/core");
  writeFileSync(
    entry,
    implementation.replace(
      'title: "Manage agents, snippets, skills, and MCP servers"',
      'title: "Manage E2E agent library"',
    ),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.agents-manager-native"),
  );
  expect(reloaded.status).toBe("replaced");

  await page.keyboard.press(`${MOD}+p`);
  const palette = page.getByRole("dialog").first();
  await page.keyboard.type("Manage E2E agent library");
  await expect(
    palette.getByRole("option", { name: "Manage E2E agent library" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expectWholeFolderReplacementSelected(
    page,
    "agents-manager-native",
    "e2e.agents-manager-native",
  );

  await revertWholeFolderReplacement(
    page,
    "agents-manager-native",
    "e2e.agents-manager-native",
  );
  await page.keyboard.press(`${MOD}+p`);
  const restoredPalette = page.getByRole("dialog").first();
  await page.keyboard.type("Manage agents snippets skills MCP servers");
  await expect(
    restoredPalette.getByRole("option", {
      name: "Manage agents, snippets, skills, and MCP servers",
    }),
  ).toBeVisible();
});

// @termco-certifies copy-replace ai-library-native source=src/builtins.ts runtime=E2E_Coder
test("AI Library provider is copyable and replacement updates consumers live", async ({
  page,
  workspace,
}) => {
  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ai-library-native",
      replacementId: "e2e.ai-library-native",
    }),
  );
  expect(copied.status).toBe("replaced");
  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ai-library-native",
  );
  const builtins = join(source, "src", "builtins.ts");
  expect(existsSync(join(source, "src", "main.ts"))).toBe(true);
  expect(existsSync(builtins)).toBe(true);
  const implementation = readFileSync(builtins, "utf8");
  expect(implementation).not.toContain("@/modules");
  expect(implementation).not.toContain("@/core");
  writeFileSync(
    builtins,
    implementation.replace('name: "Coder"', 'name: "E2E Coder"'),
  );
  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ai-library-native"),
  );
  expect(reloaded.status).toBe("replaced");

  await page.getByRole("button", { name: /Agents & Snippets/ }).first().click();
  await expect(page.getByText("E2E Coder", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Coder", { exact: true })).toHaveCount(0);
  await expectWholeFolderReplacementSelected(
    page,
    "ai-library-native",
    "e2e.ai-library-native",
  );

  await revertWholeFolderReplacement(
    page,
    "ai-library-native",
    "e2e.ai-library-native",
  );
  const restoredLibrary = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "agents-manager-native",
      capability: "ai.library",
      method: "snapshot",
      args: [],
    }),
  ) as { agents: Array<{ id: string; name: string }> };
  expect(
    restoredLibrary.agents.find((agent) => agent.id === "builtin:coder")?.name,
  ).toBe("Coder");
  await page.getByRole("button", { name: /Agents & Snippets/ }).first().click();
  await page.getByRole("button", { name: /Agents & Snippets/ }).first().click();
  await expect(page.getByText("Coder", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("E2E Coder", { exact: true })).toHaveCount(0);
});

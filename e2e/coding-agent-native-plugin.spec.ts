import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

// @termco-certifies copy-replace coding-agent-native source=ui/plugin.tsx runtime=E2E_Agents
test("Coding Agents is one source-owned provider and UI plugin that replaces live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "coding-agent-native")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "coding-agent-native",
    entrypoints: { renderer: "ui/plugin.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "coding-agent-native",
  );
  expect(profile.activationOrder).toContain("coding-agent-native");

  await page.getByRole("button", { name: /Toggle AI panel/ }).first().click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: /^agents$/i }),
  ).toBeVisible();

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "coding-agent-native",
      replacementId: "e2e.coding-agent-native",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.coding-agent-native",
  );
  const renderer = join(source, "ui", "plugin.tsx");
  expect(existsSync(join(source, "src", "main.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "driver.ts"))).toBe(true);
  expect(existsSync(renderer)).toBe(true);
  expect(
    existsSync(join(source, "ui", "store", "codingAgentsStore.ts")),
  ).toBe(true);
  expect(
    existsSync(join(source, "ui", "components", "AgentRunDetail.tsx")),
  ).toBe(true);

  const implementation = readFileSync(renderer, "utf8");
  expect(implementation).not.toContain("@/modules");
  expect(implementation).not.toContain("@/core");
  writeFileSync(
    renderer,
    implementation.replace('label: "Agents"', 'label: "E2E Agents"'),
  );

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.coding-agent-native"),
  );
  expect(reloaded.status).toBe("replaced");
  await expect(
    page.getByRole("button", { name: /^e2e agents$/i }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: /^agents$/i }),
  ).toHaveCount(0);
  await expectWholeFolderReplacementSelected(
    page,
    "coding-agent-native",
    "e2e.coding-agent-native",
  );

  await revertWholeFolderReplacement(
    page,
    "coding-agent-native",
    "e2e.coding-agent-native",
  );
  await expect(page.getByRole("button", { name: /^agents$/i }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: /^e2e agents$/i }))
    .toHaveCount(0);
});

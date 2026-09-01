import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace ports-sidebar source=src/PortsPanel.tsx runtime=E2E_PORTS_PLUGIN
test("ports is a source-owning consumer of the shared SSH provider", async ({ page, workspace }) => {
  const direct = await page.evaluate(async () => window.__termco.capabilityCall({
    consumerPluginId: "ports-sidebar",
    capability: "ssh.client",
    method: "forwardList",
    args: ["e2e-missing-connection"],
  }));
  expect(direct).toEqual([]);

  await page.getByRole("button", { name: "Ports", exact: true }).click();
  await expect(page.getByText("Only available in SSH rigs", { exact: true })).toBeVisible();

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "ports-sidebar")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "ports-sidebar",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "ports-sidebar",
  );
  expect(profile.activationOrder).toContain("ports-sidebar");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "ports-sidebar",
    replacementId: "e2e.ports-sidebar",
  }));
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.ports-sidebar");
  const renderer = join(source, "src", "renderer.tsx");
  const panel = join(source, "src", "PortsPanel.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  const rendererSource = readFileSync(renderer, "utf8");
  expect(rendererSource).toContain("ArrowDataTransferHorizontalIcon");
  const panelSource = readFileSync(panel, "utf8");
  const replacementSource = panelSource.replace(
    "              PORTS\n",
    "              E2E PORTS PLUGIN\n",
  );
  expect(replacementSource).not.toBe(panelSource);
  writeFileSync(panel, replacementSource);

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.ports-sidebar"));
  expect(apply.status).toBe("replaced");
  await page.getByRole("button", { name: "Ports", exact: true }).click();
  await expect(page.getByText("E2E PORTS PLUGIN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "ports-sidebar",
    "e2e.ports-sidebar",
  );

  await revertWholeFolderReplacement(
    page,
    "ports-sidebar",
    "e2e.ports-sidebar",
  );
  await expect(page.getByText("PORTS", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("E2E PORTS PLUGIN", { exact: true })).toHaveCount(0);
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  openSourceControl,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace source-control-sidebar source=src/baseline/components/PanelHeader.tsx runtime=E2E_refresh_source_control
test("source control is complete source-owned UI over the shared Git provider", async ({ page, workspace }) => {
  await openCommandPalette(page);
  await page.keyboard.type("toggle source control");
  await page.getByRole("option", { name: /Toggle source control/i }).first().click();
  await expect(page.getByRole("button", { name: "main", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /notes\.txt/ }).first()).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Stage all changes" })).toBeVisible();

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "source-control-sidebar")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "source-control-sidebar",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "source-control-sidebar",
  );
  expect(profile.activationOrder).toContain("source-control-sidebar");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "source-control-sidebar",
    replacementId: "e2e.source-control-sidebar",
  }));
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.source-control-sidebar");
  const panelHeader = join(source, "src", "baseline", "components", "PanelHeader.tsx");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "runtime.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "icon.ts"))).toBe(true);
  expect(existsSync(panelHeader)).toBe(true);
  const before = readFileSync(panelHeader, "utf8");
  const after = before.replace(
    'label="Refresh source control"',
    'label="E2E refresh source control"',
  );
  expect(after).not.toBe(before);
  writeFileSync(panelHeader, after);

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.source-control-sidebar"));
  expect(apply.status).toBe("replaced");
  await openSourceControl(page);
  await expect(page.getByRole("button", { name: "E2E refresh source control" }))
    .toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "source-control-sidebar",
    "e2e.source-control-sidebar",
  );

  await revertWholeFolderReplacement(
    page,
    "source-control-sidebar",
    "e2e.source-control-sidebar",
  );
  await openSourceControl(page);
  await expect(
    page.getByRole("button", { name: "Refresh source control" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "E2E refresh source control" }),
  ).toHaveCount(0);
});

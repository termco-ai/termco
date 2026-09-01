import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, MOD, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace preview-surface-native source=src/renderer.tsx runtime=E2E_source_preview
test("Web Preview is a complete source-owned surface that replaces live", async ({ page, workspace }) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "preview-surface-native")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "preview-surface-native",
    entrypoints: { renderer: "src/index.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "preview-surface-native",
  );
  expect(profile.activationOrder).toContain("preview-surface-native");

  await page.keyboard.press(`${MOD}+Shift+o`);
  await expect(page.getByText("Nothing to preview yet", { exact: true })).toBeVisible({ timeout: 10_000 });

  const copied = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "preview-surface-native",
    replacementId: "e2e.preview-surface-native",
  }));
  expect(copied.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.preview-surface-native");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  const implementation = readFileSync(renderer, "utf8");
  expect(implementation).not.toContain("@/modules");
  expect(implementation).not.toContain("@/core");
  writeFileSync(
    renderer,
    implementation.replace("Nothing to preview yet", "E2E source preview"),
  );

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.preview-surface-native"),
  );
  expect(reloaded.status).toBe("replaced");
  await expect(page.getByText("E2E source preview", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Nothing to preview yet", { exact: true })).toHaveCount(0);
  await expectWholeFolderReplacementSelected(
    page,
    "preview-surface-native",
    "e2e.preview-surface-native",
  );

  await revertWholeFolderReplacement(
    page,
    "preview-surface-native",
    "e2e.preview-surface-native",
  );
  await expect(page.getByText("Nothing to preview yet", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("E2E source preview", { exact: true }))
    .toHaveCount(0);
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace explorer-sidebar source=src/renderer.tsx runtime=E2E_Files
test("workspace Explorer is a source-owning live-replaceable plugin", async ({ page, workspace }) => {
  await expect(page.getByRole("button", { name: "README.md", exact: true })).toBeVisible();

  await openCommandPalette(page);
  await page.keyboard.type("Search files by name");
  await page.getByRole("option", { name: /Search files by name/i }).first().click();
  const search = page.getByPlaceholder("Search files…");
  await expect(search).toBeVisible();
  await search.fill("index");
  await expect(page.getByRole("button", { name: /index\.ts.*src\/index\.ts/ })).toBeVisible({ timeout: 15_000 });

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "explorer-sidebar")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "explorer-sidebar",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "explorer-sidebar",
  );
  expect(profile.activationOrder).toContain("explorer-sidebar");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "explorer-sidebar",
    replacementId: "e2e.explorer-sidebar",
  }));
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.explorer-sidebar");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "icon.ts"))).toBe(true);
  const before = readFileSync(renderer, "utf8");
  const after = before.replace('      label: "Files",', '      label: "E2E Files",');
  expect(after).not.toBe(before);
  writeFileSync(renderer, after);

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.explorer-sidebar"));
  expect(apply.status).toBe("replaced");
  await expect(page.getByRole("button", { name: "E2E Files", exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "explorer-sidebar",
    "e2e.explorer-sidebar",
  );

  await revertWholeFolderReplacement(
    page,
    "explorer-sidebar",
    "e2e.explorer-sidebar",
  );
  await expect(page.getByRole("button", { name: "Files", exact: true }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "E2E Files", exact: true }))
    .toHaveCount(0);
});

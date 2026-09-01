import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace markdown-surface source=src/renderer.tsx runtime=E2E_Raw_Source
test("Markdown is a complete source-owned tab plugin that replaces live", async ({ page, workspace }) => {
  await page.getByRole("button", { name: "README.md", exact: true }).first().click();
  await expect(page.getByText("Termco E2E").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Hello world from the workspace").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Rendered", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Raw", exact: true })).toBeVisible();

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "markdown-surface")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "markdown-surface",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "markdown-surface",
  );
  expect(profile.activationOrder).toContain("markdown-surface");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "markdown-surface",
    replacementId: "e2e.markdown-surface",
  }));
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.markdown-surface");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  writeFileSync(
    renderer,
    readFileSync(renderer, "utf8").replace(
      "          Raw\n",
      "          E2E Raw Source\n",
    ),
  );

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.markdown-surface"));
  expect(apply.status).toBe("replaced");
  await expect(page.getByRole("button", { name: "E2E Raw Source", exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Raw", exact: true })).toHaveCount(0);
  await expect(page.getByText("Hello world from the workspace").first()).toBeVisible();
  await expectWholeFolderReplacementSelected(
    page,
    "markdown-surface",
    "e2e.markdown-surface",
  );

  await revertWholeFolderReplacement(
    page,
    "markdown-surface",
    "e2e.markdown-surface",
  );
  await expect(page.getByRole("button", { name: "Raw", exact: true }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "E2E Raw Source", exact: true }))
    .toHaveCount(0);
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace header-native source=src/baseline/header/components/Header.tsx runtime=E2E_AI_CONTROL
test("the complete header can be copied, edited, and replaced live", async ({ page, workspace }) => {
  await expect(page.getByRole("button", { name: "Toggle sidebar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Manage rigs/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open a new surface", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Toggle AI panel/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agents & Snippets", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByTestId("palette-bar")).toBeVisible();

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "header-native")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "header-native",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "header-native",
  );
  expect(profile.activationOrder).toContain("header-native");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "header-native",
    replacementId: "e2e.header-native",
  }));
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.header-native");
  const renderer = join(source, "src", "baseline", "header", "components", "Header.tsx");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "icons.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "styles.ts"))).toBe(true);

  writeFileSync(
    renderer,
    readFileSync(renderer, "utf8")
      .replace('title="Toggle AI panel (⌘I)"', 'title="E2E AI CONTROL (⌘I)"'),
  );

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.header-native"));
  expect(apply.status).toBe("replaced");
  await expect(page.getByRole("button", { name: /^E2E AI CONTROL/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Toggle AI panel/ })).toHaveCount(0);
  await expectWholeFolderReplacementSelected(
    page,
    "header-native",
    "e2e.header-native",
  );

  await revertWholeFolderReplacement(
    page,
    "header-native",
    "e2e.header-native",
  );
  await expect(page.getByRole("button", { name: /^Toggle AI panel/ }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: /^E2E AI CONTROL/ }))
    .toHaveCount(0);
});

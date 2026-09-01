import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace search-sidebar source=src/renderer.tsx runtime=E2E_SEARCH_PLUGIN
test("workspace search is a source-owning live-replaceable plugin", async ({ page, workspace }) => {
  const direct = await page.evaluate(async ({ root }) => Promise.race([
    window.__termco.capabilityCall({
      consumerPluginId: "search-sidebar",
      capability: "workspace.files",
      method: "grepInteractive",
      args: [{ pattern: "Hello world", root, maxResults: 80 }, { kind: "local" }],
    }),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 5_000)),
  ]), { root: workspace.dir });
  expect(direct).not.toEqual({ timeout: true });

  await page.getByRole("button", { name: "Search in files", exact: true }).click();
  const input = page.getByLabel("Search file contents");
  await expect(input).toBeVisible();
  await input.fill("Hello world");
  await expect(page.getByText("README.md", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Hello world from the workspace/)).toBeVisible();

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "search-sidebar")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "search-sidebar",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "search-sidebar",
  );
  expect(profile.activationOrder).toContain("search-sidebar");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "search-sidebar",
    replacementId: "e2e.search-sidebar",
  }));
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.search-sidebar");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "search.ts"))).toBe(true);
  writeFileSync(renderer, readFileSync(renderer, "utf8").replace("SEARCH IN FILES", "E2E SEARCH PLUGIN"));

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.search-sidebar"));
  expect(apply.status).toBe("replaced");
  await page.getByRole("button", { name: "Search in files", exact: true }).click();
  await expect(page.getByText("E2E SEARCH PLUGIN", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "search-sidebar",
    "e2e.search-sidebar",
  );

  await revertWholeFolderReplacement(
    page,
    "search-sidebar",
    "e2e.search-sidebar",
  );
  await expect(page.getByText("SEARCH IN FILES", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("E2E SEARCH PLUGIN", { exact: true })).toHaveCount(0);
});

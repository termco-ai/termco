import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openAiPanel,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace workflows-native source=src/renderer.tsx runtime=E2E_replacement_workflows
test("Workflows is categorized, explanation-searchable, shared with AI tools, and replaces live", async ({
  page,
  workspace,
}) => {
  await openAiPanel(page);
  await page.getByRole("button", { name: "workflows", exact: true }).click();
  const panel = page.getByTestId("workflows-panel");
  await expect(panel).toHaveAttribute("data-source-plugin", "workflows-native");
  await expect(panel.getByLabel("Workflow categories")).toContainText("git");
  await expect(panel.getByLabel("Workflow categories")).toContainText("docker");

  const search = panel.getByLabel("Search workflows");
  await search.fill("working tree status, compact");
  await expect(panel.getByText("Status (short)", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Run Status (short)" }).click();
  const sheet = page.getByTestId("workflow-run-sheet");
  await expect(sheet).toContainText("git status -sb");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await search.fill("");

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "workflows-native")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "workflows-native",
    entrypoints: { renderer: "src/index.ts" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "workflows-native",
  );
  expect(profile.activationOrder).toContain("workflows-native");

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "workflows-native",
      replacementId: "e2e.workflows",
    }),
  );
  expect(copied.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.workflows");
  expect(existsSync(join(source, "src", "builtins.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "library.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  const renderer = join(source, "src", "renderer.tsx");
  writeFileSync(
    renderer,
    readFileSync(renderer, "utf8").replace(
      'placeholder="Search workflows"',
      'placeholder="E2E replacement workflows…"',
    ),
  );

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.workflows"),
  );
  expect(reloaded.status).toBe("replaced");
  await page.getByRole("button", { name: "workflows", exact: true }).click();
  await expect(page.getByLabel("Search workflows")).toHaveAttribute(
    "placeholder",
    "E2E replacement workflows…",
  );
  await expectWholeFolderReplacementSelected(
    page,
    "workflows-native",
    "e2e.workflows",
  );

  await revertWholeFolderReplacement(
    page,
    "workflows-native",
    "e2e.workflows",
  );
  await page.getByRole("button", { name: "workflows", exact: true }).click();
  await expect(page.getByLabel("Search workflows")).toHaveAttribute(
    "placeholder",
    "Search workflows",
  );
});

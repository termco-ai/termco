import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

const railLabels = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button[aria-label], [title]")]
      .map((element) =>
        element.getAttribute("aria-label") ?? element.getAttribute("title"),
      )
      .filter((label): label is string => Boolean(label)),
  );

// @termco-certifies copy-replace skills-panel-native source=src/plugin.tsx runtime=E2E_Agent_Config
test("Skills Panel is source-owned, functional, and replaces live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "skills-panel-native")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "skills-panel-native",
    entrypoints: { renderer: "src/plugin.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "skills-panel-native",
  );
  expect(profile.activationOrder).toContain("skills-panel-native");

  await expect
    .poll(() => railLabels(page), { timeout: 20_000 })
    .toContain("Adopt agent config");
  await page.getByRole("button", { name: "Adopt agent config" }).click();
  await expect(page.getByRole("button", { name: /This folder/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: /Installed/ })).toBeVisible();

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "skills-panel-native",
      replacementId: "e2e.skills-panel-native",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.skills-panel-native",
  );
  const entry = join(source, "src", "plugin.tsx");
  expect(existsSync(entry)).toBe(true);
  expect(existsSync(join(source, "src", "SkillsPanel.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "detector.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "helpers.ts"))).toBe(true);

  const implementation = readFileSync(entry, "utf8");
  expect(implementation).not.toContain("@/modules");
  expect(implementation).not.toContain("@/core");
  writeFileSync(
    entry,
    implementation.replace(
      'label: "Adopt agent config"',
      'label: "E2E Agent Config"',
    ),
  );

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.skills-panel-native"),
  );
  expect(reloaded.status).toBe("replaced");
  await expect
    .poll(() => railLabels(page), { timeout: 20_000 })
    .toContain("E2E Agent Config");
  await expect
    .poll(() => railLabels(page), { timeout: 20_000 })
    .not.toContain("Adopt agent config");
  await expectWholeFolderReplacementSelected(
    page,
    "skills-panel-native",
    "e2e.skills-panel-native",
  );

  await revertWholeFolderReplacement(
    page,
    "skills-panel-native",
    "e2e.skills-panel-native",
  );
  await expect
    .poll(() => railLabels(page), { timeout: 20_000 })
    .toContain("Adopt agent config");
  await expect
    .poll(() => railLabels(page), { timeout: 20_000 })
    .not.toContain("E2E Agent Config");
});

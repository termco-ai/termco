import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace rigs-commands source=src/commands.ts runtime=E2E_Rigs_Overview
test("rig palette workflows are a dynamic live-replaceable source plugin", async ({ page, workspace }) => {
  await openCommandPalette(page);
  await page.getByTestId("palette-bar").click();
  await page.keyboard.type("Rigs Overview");
  await expect(page.getByRole("option", { name: /Rigs: Overview/i }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "rigs-commands")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "rigs-commands",
    entrypoints: { renderer: "src/renderer.ts" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "rigs-commands",
  );
  expect(profile.activationOrder).toContain("rigs-commands");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "rigs-commands",
    replacementId: "e2e.rigs-commands",
  }));
  expect(result.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.rigs-commands");
  const commands = join(source, "src", "commands.ts");
  expect(existsSync(commands)).toBe(true);
  expect(existsSync(join(source, "src", "renderer.ts"))).toBe(true);
  writeFileSync(commands, readFileSync(commands, "utf8").replace("Rigs: Overview", "E2E Rigs Overview"));

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.rigs-commands"));
  expect(apply.status).toBe("replaced");
  await openCommandPalette(page);
  await page.getByTestId("palette-bar").click();
  await page.keyboard.type("E2E Rigs Overview");
  await expect(page.getByRole("option", { name: /E2E Rigs Overview/i }).first()).toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "rigs-commands",
    "e2e.rigs-commands",
  );
  await page.keyboard.press("Escape");

  await revertWholeFolderReplacement(
    page,
    "rigs-commands",
    "e2e.rigs-commands",
  );
  await openCommandPalette(page);
  await page.getByTestId("palette-bar").click();
  await page.keyboard.type("Rigs Overview");
  await expect(
    page.getByRole("option", { name: /Rigs: Overview/i }).first(),
  ).toBeVisible();
});

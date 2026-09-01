import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, MOD, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace trajectory-native source=src/index.tsx runtime=Open_E2E_sessions
test("Trajectory is a complete source-owned plugin that replaces live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "trajectory-native")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "trajectory-native",
    entrypoints: { renderer: "src/index.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "trajectory-native",
  );
  expect(profile.activationOrder).toContain("trajectory-native");

  await page.keyboard.press(`${MOD}+p`);
  const palette = page.getByRole("dialog").first();
  await expect(palette).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type("Open sessions");
  await palette.getByRole("option", { name: "Open sessions" }).click();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible({
    timeout: 10_000,
  });

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "trajectory-native",
      replacementId: "e2e.trajectory-native",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.trajectory-native",
  );
  const entry = join(source, "src", "index.tsx");
  expect(existsSync(entry)).toBe(true);
  expect(existsSync(join(source, "src", "actions.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "TrajectoryLedger.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "SessionList.tsx"))).toBe(true);

  const implementation = readFileSync(entry, "utf8");
  expect(implementation).not.toContain("@/modules");
  expect(implementation).not.toContain("@/core");
  writeFileSync(
    entry,
    implementation.replace(
      'title: "Open sessions"',
      'title: "Open E2E sessions"',
    ),
  );

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.trajectory-native"),
  );
  expect(reloaded.status).toBe("replaced");
  await page.keyboard.press(`${MOD}+p`);
  const replacedPalette = page.getByRole("dialog").first();
  await expect(replacedPalette).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type("Open E2E sessions");
  await expect(
    replacedPalette.getByRole("option", { name: "Open E2E sessions" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    replacedPalette.getByRole("option", { name: "Open sessions" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expectWholeFolderReplacementSelected(
    page,
    "trajectory-native",
    "e2e.trajectory-native",
  );

  await revertWholeFolderReplacement(
    page,
    "trajectory-native",
    "e2e.trajectory-native",
  );
  await page.keyboard.press(`${MOD}+p`);
  const restoredPalette = page.getByRole("dialog").first();
  await page.keyboard.type("Open sessions");
  await expect(
    restoredPalette.getByRole("option", { name: "Open sessions" }),
  ).toBeVisible();
  await expect(
    restoredPalette.getByRole("option", { name: "Open E2E sessions" }),
  ).toHaveCount(0);
});

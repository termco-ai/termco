import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace containers-native source=ui/plugin.tsx runtime=E2E_Containers
test("Containers is one complete source-owned provider and UI plugin that replaces live", async ({
  page,
  workspace,
}) => {
  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "containers-native")
      ?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "containers-native",
    entrypoints: { renderer: "ui/plugin.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain(
    "containers-native",
  );
  expect(profile.activationOrder).toContain("containers-native");

  await page.getByRole("button", { name: "Containers", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refresh containers" }),
  ).toBeVisible({ timeout: 15_000 });

  const copied = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "containers-native",
      replacementId: "e2e.containers-native",
    }),
  );
  expect(copied.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.containers-native",
  );
  const renderer = join(source, "ui", "plugin.tsx");
  expect(existsSync(join(source, "src", "main.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "ops.ts"))).toBe(true);
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "ui", "ContainersPanel.tsx"))).toBe(true);
  expect(existsSync(join(source, "ui", "ContainerDetail.tsx"))).toBe(true);

  const implementation = readFileSync(renderer, "utf8");
  expect(implementation).not.toContain("@/modules");
  expect(implementation).not.toContain("@/core");
  writeFileSync(
    renderer,
    implementation.replace('label: "Containers"', 'label: "E2E Containers"'),
  );

  const reloaded = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.containers-native"),
  );
  expect(reloaded.status).toBe("replaced");
  await expect(
    page.getByRole("button", { name: "E2E Containers", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "Containers", exact: true }),
  ).toHaveCount(0);
  await expectWholeFolderReplacementSelected(
    page,
    "containers-native",
    "e2e.containers-native",
  );

  await revertWholeFolderReplacement(
    page,
    "containers-native",
    "e2e.containers-native",
  );
  await expect(page.getByRole("button", { name: "Containers", exact: true }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "E2E Containers", exact: true }))
    .toHaveCount(0);
});

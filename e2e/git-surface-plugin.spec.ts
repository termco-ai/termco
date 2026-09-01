import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openSourceControl,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace git-surface source=src/baseline/git-history/GitHistoryPane.tsx runtime=E2E_Subject
test("Git history and diffs are source-owned and replace live", async ({ page, workspace }) => {
  await openSourceControl(page);
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await expect(page.getByText("initial commit").first()).toBeVisible({ timeout: 15_000 });

  const profile = await page.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(
    profile.plugins.find((entry) => entry.id === "git-surface")?.manifest,
  ).toMatchObject({
    schemaVersion: 3,
    id: "git-surface",
    entrypoints: { renderer: "src/renderer.tsx" },
  });
  expect(profile.modules.map((entry) => entry.pluginId)).toContain("git-surface");
  expect(profile.activationOrder).toContain("git-surface");

  const result = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "git-surface",
    replacementId: "e2e.git-surface",
  }));
  expect(result.status).toBe("replaced");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.git-surface");
  const historyPane = join(
    source,
    "src",
    "baseline",
    "git-history",
    "GitHistoryPane.tsx",
  );
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "runtime.ts"))).toBe(true);
  expect(existsSync(historyPane)).toBe(true);
  const before = readFileSync(historyPane, "utf8");
  const after = before.replace('<div className="min-w-0">Subject</div>', '<div className="min-w-0">E2E Subject</div>');
  expect(after).not.toBe(before);
  writeFileSync(historyPane, after);

  const apply = await page.evaluate(() => window.__termco.applyPlugin("e2e.git-surface"));
  expect(apply.status).toBe("replaced");
  // Reopen through the unchanged source-control command after the live swap.
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await expect(page.getByText("E2E Subject", { exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("initial commit").first()).toBeVisible();
  await expectWholeFolderReplacementSelected(
    page,
    "git-surface",
    "e2e.git-surface",
  );

  await revertWholeFolderReplacement(
    page,
    "git-surface",
    "e2e.git-surface",
  );
  await page.getByRole("button", { name: /Commit Graph/ }).first().click();
  await expect(page.getByText("Subject", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E Subject", { exact: true })).toHaveCount(0);
});

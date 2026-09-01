/** The plugin-selected application shell owns the root and mounts the selected
 * workspace, dock, and statusbar contributions. Empty slots collapse. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectErrors, expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

test("core shell hosts the selected workspace plugin in its root slot", async ({
  page,
}) => {
  // The selected shell is the root.
  await expect(page.getByTestId("core-shell")).toBeVisible();
  await expect(page.getByTestId("slot-workspace")).toBeVisible();
  // The selected workspace contribution renders inside it.
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(page.getByTestId("workspace")).toBeVisible();
  // Empty slots collapse completely, without stray chrome.
  await expect(page.getByTestId("slot-rail")).toHaveCount(0);
  // The AI plugin contributes the dock host; while the AI
  // panel is closed it renders null, so the bare region has no size/chrome.
  await expect(page.getByTestId("slot-dock")).toHaveCount(1);
  await expect(page.getByTestId("ai-panel")).toHaveCount(0);
  // The statusbar plugin fills the statusbar slot and renders Ready.
  await expect(page.getByTestId("slot-statusbar")).toBeVisible();
  await expect(page.getByTestId("slot-statusbar")).toContainText("Ready");
});

test("boots without unexpected console/page errors", async ({ app }) => {
  // Attach the collector before waiting so boot-time errors are caught too.
  const page = await app.firstWindow();
  const { errors } = collectErrors(page);
  await page
    .getByTestId("core-shell")
    .waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByTestId("workspace")
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(3000);
  expect(errors, `unexpected errors:\n${errors.join("\n")}`).toEqual([]);
});

// @termco-certifies copy-replace ui-shell-native source=src/shell.ts runtime=e2e-core-shell
test("the complete application shell folder replaces live and reverts", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ui-shell-native",
      replacementId: "e2e.ui-shell-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.ui-shell-native",
    "src",
    "shell.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    '"data-testid": "core-shell",',
    '"data-testid": "e2e-core-shell",',
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.ui-shell-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect(page.getByTestId("e2e-core-shell")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("core-shell")).toHaveCount(0);
  await expectWholeFolderReplacementSelected(
    page,
    "ui-shell-native",
    "e2e.ui-shell-native",
  );

  await revertWholeFolderReplacement(
    page,
    "ui-shell-native",
    "e2e.ui-shell-native",
  );
  await expect(page.getByTestId("core-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("e2e-core-shell")).toHaveCount(0);
});

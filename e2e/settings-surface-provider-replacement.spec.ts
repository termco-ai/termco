import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, MOD, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  openFile,
  revertWholeFolderReplacement,
} from "./helpers";

// Terminal and workspace provider replacement intentionally destroys the
// disposable E2E session graph. Production still shows the warning.
process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

function copiedSource(
  userData: string,
  replacementId: string,
  relativePath: string,
): string {
  return join(userData, "plugin-platform", "plugins", replacementId, relativePath);
}

async function replaceSource(
  page: Parameters<typeof expectWholeFolderReplacementSelected>[0],
  userData: string,
  originalPluginId: string,
  replacementId: string,
  relativePath: string,
  edit: (source: string) => string,
): Promise<void> {
  const copied = await page.evaluate(
    ({ pluginId, replacementPluginId }) =>
      window.__termcoE2E.copyAndReplacePluginThroughPlan({
        pluginId,
        replacementId: replacementPluginId,
      }),
    { pluginId: originalPluginId, replacementPluginId: replacementId },
  );
  expect(copied.status).toBe("replaced");
  const path = copiedSource(userData, replacementId, relativePath);
  expect(existsSync(path)).toBe(true);
  const original = readFileSync(path, "utf8");
  const edited = edit(original);
  expect(edited).not.toBe(original);
  writeFileSync(path, edited);
  const reloaded = await page.evaluate(
    (pluginId) => window.__termco.applyPlugin(pluginId),
    replacementId,
  );
  expect(reloaded.status).toBe("replaced");
}

// @termco-certifies copy-replace editor-surface-native source=src/renderer.tsx runtime=E2E_editor_command
test("editor surface replacement changes the unchanged command palette consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "editor-surface-native",
    "e2e.editor-surface",
    "src/renderer.tsx",
    (source) => source.replace('title: "New editor tab",', 'title: "E2E editor tab",'),
  );
  await openCommandPalette(page);
  await page.keyboard.type("E2E editor tab");
  await expect(page.getByRole("option", { name: /E2E editor tab/i }).first())
    .toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "editor-surface-native",
    "e2e.editor-surface",
  );
  await page.keyboard.press("Escape");
  await revertWholeFolderReplacement(
    page,
    "editor-surface-native",
    "e2e.editor-surface",
  );
  await openCommandPalette(page);
  await page.keyboard.type("New editor tab");
  await expect(page.getByRole("option", { name: /New editor tab/i }).first())
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("option", { name: /E2E editor tab/i }))
    .toHaveCount(0);
});

// @termco-certifies copy-replace surface-search-native source=src/searchRegistry.ts runtime=Git_search_header_target
test("surface search replacement reaches the unchanged workspace and header consumers", async ({
  page,
  workspace,
}) => {
  await openFile(page, "notes.txt");
  await replaceSource(
    page,
    workspace.userData,
    "surface-search-native",
    "e2e.surface-search",
    "src/searchRegistry.ts",
    (source) =>
      source.replace(
        "return this.#entries.get(tabId)?.target ?? null;",
        [
          "const target = this.#entries.get(tabId)?.target;",
          '    return target ? { ...target, kind: "git-history" as const } : null;',
        ].join("\n    "),
      ),
  );
  await page.keyboard.press(`${MOD}+f`);
  await expect(page.getByPlaceholder(/^Git search/)).toBeVisible({
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    page,
    "surface-search-native",
    "e2e.surface-search",
  );
  await page.keyboard.press("Escape");
  await revertWholeFolderReplacement(
    page,
    "surface-search-native",
    "e2e.surface-search",
  );
  await page.keyboard.press(`${MOD}+f`);
  await expect(page.getByPlaceholder(/^Search/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder(/^Git search/)).toHaveCount(0);
});

// @termco-certifies copy-replace workspace-rig-workflows-native source=src/workflows.ts runtime=E2E_Rig_created
test("rig workflow replacement changes creation through the unchanged header", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "workspace-rig-workflows-native",
    "e2e.workspace-rig-workflows",
    "src/workflows.ts",
    (source) =>
      source.replace(
        'name: `Rig ${rigSnapshot.rigs.length + 1}`,',
        'name: `E2E Rig ${rigSnapshot.rigs.length + 1}`,',
      ),
  );
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.getByRole("button", { name: /Local workspace/ }).click();
  await expect(page.getByText(/E2E Rig \d+/, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-rig-workflows-native",
    "e2e.workspace-rig-workflows",
  );
  await revertWholeFolderReplacement(
    page,
    "workspace-rig-workflows-native",
    "e2e.workspace-rig-workflows",
  );
  await page.getByRole("button", { name: "New rig", exact: true }).first().click();
  await page.getByRole("button", { name: /Local workspace/ }).click();
  await expect(page.getByText(/^Rig \d+$/, { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
});

// @termco-certifies copy-replace workspace-rigs-native source=src/store.ts runtime=E2E_hydrated_rig_name
test("workspace rigs replacement reaches the unchanged header consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "workspace-rigs-native",
    "e2e.workspace-rigs",
    "src/store.ts",
    (source) =>
      source.replace(
        "...rig,\n        workspace:",
        '...rig,\n        name: `E2E ${rig.name}`,\n        workspace:',
      ),
  );
  await expect(page.getByText(/^E2E /, { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-rigs-native",
    "e2e.workspace-rigs",
  );
  await revertWholeFolderReplacement(
    page,
    "workspace-rigs-native",
    "e2e.workspace-rigs",
  );
  await expect(page.getByText(/^E2E /, { exact: false })).toHaveCount(0);
});

// @termco-certifies copy-replace workspace-shell-native source=src/workspace/components/AppShell.tsx runtime=e2e-workspace_class
test("workspace shell replacement swaps the complete unchanged workspace root", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "workspace-shell-native",
    "e2e.workspace-shell",
    "src/workspace/components/AppShell.tsx",
    (source) => source.replace("termco-workspace flex", "e2e-workspace flex"),
  );
  await expect(page.locator(".e2e-workspace")).toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-shell-native",
    "e2e.workspace-shell",
  );
  await revertWholeFolderReplacement(
    page,
    "workspace-shell-native",
    "e2e.workspace-shell",
  );
  await expect(page.locator(".termco-workspace")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".e2e-workspace")).toHaveCount(0);
});

// @termco-certifies copy-replace terminal-surface-native source=src/terminal/block/ShellInput.tsx runtime=E2E_Run_a_command
test("terminal surface replacement changes the unchanged footer composition", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "terminal-surface-native",
    "e2e.terminal-surface",
    "src/terminal/block/ShellInput.tsx",
    (source) => source.replace("Run a command  -", "E2E Run a command  -"),
  );
  await page.keyboard.press(`${MOD}+Shift+t`);
  await expect(page.getByText(/E2E Run a command/).first()).toBeVisible({
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    page,
    "terminal-surface-native",
    "e2e.terminal-surface",
  );
  await revertWholeFolderReplacement(
    page,
    "terminal-surface-native",
    "e2e.terminal-surface",
  );
  await expect(page.getByText(/E2E Run a command/)).toHaveCount(0);
  await expect(page.getByText(/Run a command/).first()).toBeVisible({
    timeout: 15_000,
  });
});

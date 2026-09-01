import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// workspace.tabs replacement intentionally destroys the current tab graph.
// This spec runs against one disposable Electron instance per test.
process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

function copiedSource(
  userData: string,
  replacementId: string,
  relativePath: string,
): string {
  return join(userData, "plugin-platform", "plugins", replacementId, relativePath);
}

// @termco-certifies copy-replace sidebar-navigation-native source=src/navigation.ts runtime=search_default_view
test("sidebar navigation provider replacement reaches the unchanged Explorer consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "sidebar-navigation-native",
      replacementId: "e2e.sidebar-navigation",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = copiedSource(
    workspace.userData,
    "e2e.sidebar-navigation",
    "src/navigation.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    'return this.#storage.getItem(SIDEBAR_VIEW_STORAGE_KEY) || "explorer";',
    'return "search";',
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);
  expect(
    (await page.evaluate(() =>
      window.__termco.applyPlugin("e2e.sidebar-navigation"),
    )).status,
  ).toBe("replaced");
  await expect(page.getByTestId("workspace-search-sidebar")).toBeVisible({
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    page,
    "sidebar-navigation-native",
    "e2e.sidebar-navigation",
  );
  await revertWholeFolderReplacement(
    page,
    "sidebar-navigation-native",
    "e2e.sidebar-navigation",
  );
  await expect(page.getByTestId("workspace-search-sidebar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "README.md", exact: true }))
    .toBeVisible({ timeout: 15_000 });
});

// @termco-certifies copy-replace workspace-environment-native source=src/environment.ts runtime=Home_breadcrumb
test("workspace environment provider replacement reaches the unchanged shell consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "workspace-environment-native",
      replacementId: "e2e.workspace-environment",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = copiedSource(
    workspace.userData,
    "e2e.workspace-environment",
    "src/environment.ts",
  );
  const original = readFileSync(source, "utf8");
  const candidateHome =
    '(await Promise.resolve(dependencies.workspace.currentDir())).replace(/^\\/private(?=\\/(?:var|tmp)(?:\\/|$))/, "")';
  const edited = original
    .replace(
      "home = normalizePath(await Promise.resolve(dependencies.workspace.homeDir()));",
      `home = ${candidateHome};`,
    )
    .replace(
      [
        "return normalizePath(",
        "      await Promise.resolve(dependencies.workspace.homeDir()),",
        "    );",
      ].join("\n"),
      `return ${candidateHome};`,
    );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);
  expect(
    (await page.evaluate(() =>
      window.__termco.applyPlugin("e2e.workspace-environment"),
    )).status,
  ).toBe("replaced");
  await expect(
    page.locator("footer").getByText("Home", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-environment-native",
    "e2e.workspace-environment",
  );
  await revertWholeFolderReplacement(
    page,
    "workspace-environment-native",
    "e2e.workspace-environment",
  );
  await expect(
    page.locator("footer").getByText("Home", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator("footer").getByText(basename(workspace.dir), { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
});

// @termco-certifies copy-replace workspace-tab-actions-native source=src/actions.ts runtime=e2e-shell_tab
test("tab-actions provider replacement mutates the unchanged shared tab provider", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "workspace-tab-actions-native",
      replacementId: "e2e.workspace-tab-actions",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = copiedSource(
    workspace.userData,
    "e2e.workspace-tab-actions",
    "src/actions.ts",
  );
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "data: {\n          cwd,",
    'data: {\n          cwd,\n          customTitle: "e2e-shell",',
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);
  expect(
    (await page.evaluate(() =>
      window.__termco.applyPlugin("e2e.workspace-tab-actions"),
    )).status,
  ).toBe("replaced");

  await page.getByRole("tab", { selected: true }).click({ button: "right" });
  await page.getByText("New Tab to the Right", { exact: true }).click();
  await expect(page.getByRole("tab", { name: /e2e-shell/ })).toBeVisible({
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-tab-actions-native",
    "e2e.workspace-tab-actions",
  );
  await revertWholeFolderReplacement(
    page,
    "workspace-tab-actions-native",
    "e2e.workspace-tab-actions",
  );

  await page.getByRole("tab", { selected: true }).click({ button: "right" });
  await page.getByText("New Tab to the Right", { exact: true }).click();
  await expect(page.getByRole("tab", { name: /e2e-shell/ })).toHaveCount(1);
});

// @termco-certifies copy-replace workspace-tabs-native source=src/store.ts runtime=1001_allocated_tab_id
test("workspace-tabs provider replacement reaches the unchanged header consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "workspace-tabs-native",
      replacementId: "e2e.workspace-tabs",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = copiedSource(
    workspace.userData,
    "e2e.workspace-tabs",
    "src/store.ts",
  );
  const original = readFileSync(source, "utf8");
  const edited = original.replace("#nextId = 1;", "#nextId = 1001;");
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);
  expect(
    (await page.evaluate(() => window.__termco.applyPlugin("e2e.workspace-tabs")))
      .status,
  ).toBe("replaced");
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("tab", { selected: true })
          .getAttribute("data-tab-id"),
      ))
    .toBeGreaterThanOrEqual(1001);
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-tabs-native",
    "e2e.workspace-tabs",
  );
  await revertWholeFolderReplacement(
    page,
    "workspace-tabs-native",
    "e2e.workspace-tabs",
  );
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole("tab", { selected: true })
          .getAttribute("data-tab-id"),
      ))
    .toBeLessThan(1000);
});

// @termco-certifies copy-replace workspace-presentation-native source=src/store.ts runtime=zenMode_true
test("presentation provider replacement reaches the unchanged header consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "workspace-presentation-native",
      replacementId: "e2e.workspace-presentation",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = copiedSource(
    workspace.userData,
    "e2e.workspace-presentation",
    "src/store.ts",
  );
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "this.#snapshot = { revision: this.#snapshot.revision + 1, ...state };",
    "this.#snapshot = { revision: this.#snapshot.revision + 1, ...state, context: { ...state.context, zenMode: true } };",
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);
  expect(
    (await page.evaluate(() =>
      window.__termco.applyPlugin("e2e.workspace-presentation"),
    )).status,
  ).toBe("replaced");
  await expect(page.getByRole("button", { name: "Toggle sidebar" }))
    .toHaveCount(0);
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-presentation-native",
    "e2e.workspace-presentation",
  );
  await revertWholeFolderReplacement(
    page,
    "workspace-presentation-native",
    "e2e.workspace-presentation",
  );
  await expect(page.getByRole("button", { name: "Toggle sidebar" }))
    .toBeVisible({ timeout: 15_000 });
});

// @termco-certifies copy-replace agent-activity-native source=src/activity.ts runtime=E2E_notification_badge
test("agent-activity provider replacement reaches the unchanged header consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "agent-activity-native",
      replacementId: "e2e.agent-activity",
    }),
  );
  expect(result.status).toBe("replaced");
  const source = copiedSource(
    workspace.userData,
    "e2e.agent-activity",
    "src/activity.ts",
  );
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "notifications: [],",
    [
      "notifications: [{",
      '      id: "e2e-notification",',
      '      source: "local",',
      "      leafId: 0,",
      "      tabId: 0,",
      '      agent: "E2E Agent",',
      '      kind: "finished",',
      "      at: 0,",
      "      read: false,",
      "    }],",
    ].join("\n    "),
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);
  expect(
    (await page.evaluate(() =>
      window.__termco.applyPlugin("e2e.agent-activity"),
    )).status,
  ).toBe("replaced");
  const activityButton = page.getByTitle("Agent activity");
  await expect(activityButton.getByText("1", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    page,
    "agent-activity-native",
    "e2e.agent-activity",
  );
  await revertWholeFolderReplacement(
    page,
    "agent-activity-native",
    "e2e.agent-activity",
  );
  await expect(activityButton.getByText("1", { exact: true })).toHaveCount(0);
});

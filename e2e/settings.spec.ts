/**
 * Settings: opens as an in-window view (like the agents view), exposes every
 * tab in the left rail, searches across tabs, and its controls (mode cards,
 * switches) work and reflect in the DOM.
 */
import { expect, MAIN, openSettingsWindow, test } from "./fixtures";
import { _electron as electron } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectWholeFolderReplacementSelected,
  openAiConversation,
  revertWholeFolderReplacement,
} from "./helpers";

const TABS = [
  "General",
  "Appearance",
  "Shortcuts",
  "Terminal",
  "Editor",
  "Languages",
  "Models",
  "About",
];

test("opens the in-window settings view with every tab in the rail", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await expect(settings.getByTestId("settings-view")).toBeVisible();

  for (const tab of TABS) {
    await expect(
      settings.getByRole("button", { name: tab }).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  // The rail groups the workspace-scoped tabs under a heading.
  await expect(settings.getByText("Workspace").first()).toBeVisible();
});

test("navigates every settings tab", async ({ app, page }) => {
  const settings = await openSettingsWindow(app, page);
  const go = (name: string) =>
    settings.getByRole("button", { name, exact: true }).first();

  await go("Appearance").click();
  await expect(settings.getByText("Color theme").first()).toBeVisible({
    timeout: 8_000,
  });

  await go("Shortcuts").click();
  await expect(
    settings.getByText(/command palette|shortcut/i).first(),
  ).toBeVisible({ timeout: 8_000 });

  await go("Terminal").click();
  await expect(settings.getByText("Cursor blinking").first()).toBeVisible({
    timeout: 8_000,
  });

  await go("Editor").click();
  await expect(settings.getByText("Vim mode").first()).toBeVisible({
    timeout: 8_000,
  });

  await go("Models").click();
  await expect(settings.getByText(/model|provider/i).first()).toBeVisible({
    timeout: 8_000,
  });

  await go("About").click();
  await expect(
    settings
      .getByTestId("about-section")
      .getByText("Electron", { exact: true }),
  ).toBeVisible({ timeout: 8_000 });

  await go("General").click();
  await expect(settings.getByText("Launch at login").first()).toBeVisible({
    timeout: 8_000,
  });
});

test("searches settings across tabs and jumps to the owning tab", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  const search = settings.getByLabel("Search settings");

  await search.fill("vim");
  // The section is replaced by cross-tab results.
  await expect(settings.getByText("Search", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  await settings.getByText("Vim mode", { exact: true }).click();

  // Landed on the Editor tab, with the query cleared.
  await expect(settings.getByText("Word wrap").first()).toBeVisible({
    timeout: 8_000,
  });
  await expect(search).toHaveValue("");
});

test("mode cards apply a theme class to the document", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Appearance", exact: true })
    .first()
    .click();

  await settings
    .getByRole("button", { name: "Dark", exact: true })
    .first()
    .click();
  await expect
    .poll(
      () =>
        settings.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        ),
      { timeout: 8_000 },
    )
    .toBe(true);

  await settings
    .getByRole("button", { name: "Light", exact: true })
    .first()
    .click();
  await expect
    .poll(
      () =>
        settings.evaluate(() =>
          document.documentElement.classList.contains("light"),
        ),
      { timeout: 8_000 },
    )
    .toBe(true);
});

test("Plugins: profile filter narrows the catalog; global search jumps to its owning plugin section", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await settings
    .getByTestId("plugins-section")
    .waitFor({ state: "visible", timeout: 15_000 });

  // The manager itself is an ordinary profile-selected plugin.
  await expect(
    settings.getByTestId("profile-plugin-row-plugin-manager-native").first(),
  ).toBeVisible({ timeout: 10_000 });

  // Source metadata narrows the selected profile without relying on deleted
  // manifest service declarations.
  const filter = settings.getByTestId("plugin-search");
  await filter.fill("remote agent deployment");
  await expect(
    settings.getByTestId("profile-plugin-row-ssh-native"),
  ).toBeVisible();
  await expect(
    settings.getByTestId("profile-plugin-row-lsp-native"),
  ).toHaveCount(0);
  await expect(
    settings.getByTestId("profile-plugin-row-events-native"),
  ).toHaveCount(0);

  // A miss shows the quiet empty hint.
  await filter.fill("zzz-no-such-plugin");
  await expect(settings.getByTestId("plugin-search-empty")).toBeVisible();
  await filter.fill("");

  // Global settings search (from another tab) lists the selected plugin and
  // clicking it jumps to the Plugins section.
  await settings
    .getByRole("button", { name: "General", exact: true })
    .first()
    .click();
  const search = settings.getByLabel("Search settings");
  await search.fill("ssh-native");
  await settings
    .getByText("Native SSH Runtime", { exact: true })
    .first()
    .click();
  await expect(settings.getByTestId("plugins-section")).toBeVisible({
    timeout: 10_000,
  });
  await expect(search).toHaveValue("");
});

test("Plugins: the full live catalog exposes details, fork, and activation controls", async ({
  app,
  page,
  workspace,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  const section = settings.getByTestId("plugins-section");
  await section.waitFor({ state: "visible", timeout: 15_000 });

  const catalog = await settings.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog.map((plugin) => ({
      id: plugin.id,
      essentialReason: plugin.essentialReason,
    })),
  );
  const catalogIds = catalog.map((plugin) => plugin.id);
  expect(catalogIds.length).toBeGreaterThan(90);
  await expect(
    section.getByText(`${catalogIds.length} plugins in the active profile`),
  ).toBeVisible();
  await expect(
    section.locator('[data-testid^="profile-plugin-row-"]'),
  ).toHaveCount(catalogIds.length);

  const manager = section.getByTestId(
    "profile-plugin-row-plugin-manager-native",
  );
  await expect(manager.getByRole("button", { name: "Details" })).toBeVisible();
  await expect(manager.getByRole("button", { name: "Fork" })).toBeVisible();

  const protectedPluginIds = catalog
    .filter((plugin) => Boolean(plugin.essentialReason))
    .map((plugin) => plugin.id)
    .sort();
  expect(protectedPluginIds).toEqual([
    "plugin-manager-native",
    "settings-native",
    "ui-shell-native",
    "workspace-shell-native",
  ]);
  for (const pluginId of protectedPluginIds) {
    await expect(
      section
        .getByTestId(`profile-plugin-row-${pluginId}`)
        .getByRole("button", { name: "Deactivate" }),
    ).toBeDisabled();
  }

  const skills = section.getByTestId(
    "profile-plugin-row-skills-panel-native",
  );
  const sidebarRailLabels = () =>
    settings.evaluate(() =>
      [...document.querySelectorAll("button[aria-label], [title]")]
        .map(
          (element) =>
            element.getAttribute("aria-label") ?? element.getAttribute("title"),
        )
        .filter((label): label is string => Boolean(label)),
    );
  await expect(
    skills.getByRole("button", { name: "Deactivate" }),
  ).toBeEnabled();
  await expect
    .poll(sidebarRailLabels, { timeout: 15_000 })
    .toContain("Adopt agent config");
  await expect(
    section.getByRole("button", { name: "Open plugins folder" }),
  ).toBeEnabled();
  await section.getByRole("button", { name: "Open plugins folder" }).click();
  await expect
    .poll(() =>
      existsSync(join(workspace.userData, "plugin-platform", "plugins")),
    )
    .toBe(true);

  await skills.getByRole("button", { name: "Deactivate" }).click();
  await skills.getByRole("button", { name: "Deactivate plugin" }).click();
  await expect
    .poll(() =>
      settings.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog.find(
          (plugin) => plugin.id === "skills-panel-native",
        )?.enabled,
      ),
    )
    .toBe(false);
  await expect
    .poll(sidebarRailLabels, { timeout: 15_000 })
    .not.toContain("Adopt agent config");
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await expect(
    skills.getByRole("button", { name: "Activate" }),
  ).toBeEnabled({ timeout: 15_000 });

  await skills.getByRole("button", { name: "Activate" }).click();
  await expect
    .poll(() =>
      settings.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog.find(
          (plugin) => plugin.id === "skills-panel-native",
        )?.enabled,
      ),
    )
    .toBe(true);
  await expect
    .poll(sidebarRailLabels, { timeout: 15_000 })
    .toContain("Adopt agent config");
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await expect(
    skills.getByRole("button", { name: "Deactivate" }),
  ).toBeEnabled({ timeout: 15_000 });
});

test("Plugins: disabling and reenabling a provider removes and restores its UI without remounting Settings", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await settings
    .getByTestId("plugins-section")
    .waitFor({ state: "visible", timeout: 15_000 });

  await settings.getByTestId("settings-view").evaluate((element) => {
    element.setAttribute("data-plugin-transaction-sentinel", "preserved");
  });
  const sidebarRailLabels = () =>
    settings.evaluate(() =>
      [...document.querySelectorAll("button[aria-label], [title]")]
        .map(
          (element) =>
            element.getAttribute("aria-label") ?? element.getAttribute("title"),
        )
        .filter((label): label is string => Boolean(label)),
    );
  await expect
    .poll(sidebarRailLabels, { timeout: 15_000 })
    .toContain("Source Control");

  // Match a persisted user profile where one hard Git consumer was already
  // disabled before its provider is toggled.
  const gitSurface = settings.getByTestId("profile-plugin-row-git-surface");
  await gitSurface.getByRole("button", { name: "Deactivate" }).click();
  await gitSurface
    .getByRole("button", { name: "Deactivate plugin" })
    .click();
  await expect
    .poll(() =>
      settings.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog.find(
          (plugin) => plugin.id === "git-surface",
        )?.enabled,
      ),
    )
    .toBe(false);

  const git = settings.getByTestId("profile-plugin-row-git-native");
  await git.getByRole("button", { name: "Deactivate" }).click();
  await git.getByRole("button", { name: "Deactivate plugin" }).click();
  await expect
    .poll(() =>
      settings.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog.find(
          (plugin) => plugin.id === "git-native",
        )?.enabled,
      ),
    )
    .toBe(false);
  await expect(
    settings.locator('[data-plugin-transaction-sentinel="preserved"]'),
  ).toHaveCount(1);
  await expect(settings.getByTestId("plugins-section")).toBeVisible();
  await expect
    .poll(sidebarRailLabels, { timeout: 15_000 })
    .not.toContain("Source Control");

  await git.getByRole("button", { name: "Activate" }).click();
  await expect
    .poll(() =>
      settings.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog.find(
          (plugin) => plugin.id === "git-native",
        )?.enabled,
      ),
    )
    .toBe(true);
  await expect(
    settings.locator('[data-plugin-transaction-sentinel="preserved"]'),
  ).toHaveCount(1);
  await expect
    .poll(sidebarRailLabels, { timeout: 15_000 })
    .toContain("Source Control");

  await gitSurface.getByRole("button", { name: "Activate" }).click();
  await expect
    .poll(() =>
      settings.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog.find(
          (plugin) => plugin.id === "git-surface",
        )?.enabled,
      ),
    )
    .toBe(true);
});

test("Plugins: a cold-booted user profile can disable and reenable Git", async ({
  app,
  page,
  workspace,
}) => {
  const initialSettings = await openSettingsWindow(app, page);
  await initialSettings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await initialSettings
    .getByTestId("profile-plugin-row-git-surface")
    .getByRole("button", { name: "Deactivate" })
    .click();
  await initialSettings
    .getByTestId("profile-plugin-row-git-surface")
    .getByRole("button", { name: "Deactivate plugin" })
    .click();
  await expect
    .poll(() =>
      initialSettings.evaluate(async () =>
        (await window.__termco.rendererPluginProfile()).catalog.find(
          (plugin) => plugin.id === "git-surface",
        )?.enabled,
      ),
    )
    .toBe(false);

  await app.close();
  const restarted = await electron.launch({
    args: [MAIN, workspace.dir],
    env: {
      ...process.env,
      TERMCO_USER_DATA: workspace.userData,
      TERMCO_E2E: "1",
      TERMCO_MCP_PORT: "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  try {
    const restartedPage = await restarted.firstWindow();
    await restartedPage
      .getByTestId("workspace")
      .waitFor({ state: "visible", timeout: 30_000 });
    const settings = await openSettingsWindow(restarted, restartedPage);
    await settings
      .getByRole("button", { name: "Plugins", exact: true })
      .first()
      .click();
    const git = settings.getByTestId("profile-plugin-row-git-native");

    await git.getByRole("button", { name: "Deactivate" }).click();
    await git.getByRole("button", { name: "Deactivate plugin" }).click();
    await expect
      .poll(() =>
        settings.evaluate(async () =>
          (await window.__termco.rendererPluginProfile()).catalog.find(
            (plugin) => plugin.id === "git-native",
          )?.enabled,
        ),
      )
      .toBe(false);

    await git.getByRole("button", { name: "Activate" }).click();
    await expect
      .poll(() =>
        settings.evaluate(async () =>
          (await window.__termco.rendererPluginProfile()).catalog.find(
            (plugin) => plugin.id === "git-native",
          )?.enabled,
        ),
      )
      .toBe(true);
  } finally {
    await restarted.close();
  }
});

test("Plugins: disabling a leaf plugin preserves the mounted Settings tree", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await settings
    .getByTestId("plugins-section")
    .waitFor({ state: "visible", timeout: 15_000 });
  await settings.getByTestId("settings-view").evaluate((element) => {
    element.setAttribute("data-plugin-transaction-sentinel", "preserved");
  });

  await settings.evaluate(async () => {
    const impact = await window.__termco.previewPluginEnabled(
      "skills-panel-native",
      false,
    );
    await window.__termco.setPluginEnabled("skills-panel-native", false, {
      previewId: impact.previewId,
      generation: impact.generation,
    });
  });

  await expect(
    settings.locator('[data-plugin-transaction-sentinel="preserved"]'),
  ).toHaveCount(1, { timeout: 1_000 });
  await expect(settings.getByTestId("plugins-section")).toBeVisible();
});

test("Plugins: groups features by category and searches their explanations", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await settings
    .getByTestId("plugins-section")
    .waitFor({ state: "visible", timeout: 15_000 });

  const groups = settings.locator(
    '[data-testid^="profile-plugin-category-"]',
  );
  await expect
    .poll(() => groups.count(), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);

  // Search is metadata-aware: a phrase from the manifest description finds the plugin
  // even though those words are not in its name or id.
  const filter = settings.getByTestId("plugin-search");
  await filter.fill("shared SSH connection pool");
  const ssh = settings.getByTestId("profile-plugin-row-ssh-native");
  await expect(ssh).toBeVisible();
  await expect(ssh).toContainText(/shared SSH connection pool/i);
  await expect(
    settings.getByTestId("profile-plugin-row-events-native"),
  ).toHaveCount(0);
});

test("Plugins: canonical profile plugins expose selected source and activation metadata", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await settings
    .getByTestId("plugins-section")
    .waitFor({ state: "visible", timeout: 15_000 });

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toContain("ssh-native");
  expect(profile.modules.map((module) => module.pluginId)).toContain(
    "ssh-native",
  );
  expect(profile.activationOrder).toContain("ssh-native");

  // Source metadata remains searchable without service declarations in the
  // strict-v3 manifest.
  const filter = settings.getByTestId("plugin-search");
  await filter.fill("shared SSH connection pool");

  const ssh = settings.getByTestId("profile-plugin-row-ssh-native");
  await expect(ssh).toBeVisible({ timeout: 10_000 });
  await expect(ssh).toContainText("Native SSH Runtime");
  await expect(ssh).toContainText("Owns the shared SSH connection pool");
  await expect(settings.getByTestId("profile-plugin-row-lsp-native")).toHaveCount(0);
  await expect(
    settings.getByTestId("profile-plugin-row-events-native"),
  ).toHaveCount(0);

  await settings.getByTestId("profile-plugin-details-ssh-native").click();
  await expect(ssh).toContainText("plugin-repository/plugins/ssh-native");
  await expect(ssh).toContainText(/Profile layer .* selected this plugin/);
});

test("Plugins: copies complete source and activates a whole-plugin replacement without restart", async ({
  app,
  page,
  workspace,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  await expect(
    settings.getByTestId("profile-plugin-copy-ui-shell-native"),
  ).toBeVisible({ timeout: 15_000 });

  const result = await settings.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "ui-shell-native",
      replacementId: "e2e.ui-shell",
    }),
  );
  expect(result.status).toBe("replaced");

  // Replacing the root shell intentionally remounts its child tree. Navigate
  // back to Plugins and verify the new profile tree is the one now rendered.
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();

  await expect(
    settings.getByTestId("profile-plugin-row-e2e.ui-shell"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    settings.getByTestId("profile-plugin-row-ui-shell-native"),
  ).toContainText("Inactive");
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.ui-shell");
  expect(existsSync(join(source, "src", "renderer.ts"))).toBe(true);
  expect(existsSync(join(source, "README.md"))).toBe(true);
  const manifest = JSON.parse(
    readFileSync(join(source, "termco-plugin.json"), "utf8"),
  ) as { id: string; replaces: string };
  expect(manifest).toMatchObject({
    id: "e2e.ui-shell",
    replaces: "ui-shell-native",
  });
  const activeState = JSON.parse(
    readFileSync(join(workspace.userData, "plugin-platform", "active-profile.json"), "utf8"),
  ) as { profileId: string };
  expect(activeState.profileId).toMatch(/^termco\.user\./);
  expect(
    existsSync(
      join(
        workspace.userData,
        "plugin-platform",
        "profiles",
        activeState.profileId,
        "profile.json",
      ),
    ),
  ).toBe(true);

  const shellSource = join(source, "src", "shell.ts");
  writeFileSync(
    shellSource,
    `${readFileSync(shellSource, "utf8")}\n// edited live by the replacement E2E\n`,
  );
  const apply = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.ui-shell"),
  );
  expect(apply.status).toBe("replaced");
  const reloadedCatalog = await settings.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(
    reloadedCatalog.find((plugin) => plugin.id === "e2e.ui-shell")?.version,
  ).toBe("1.0.2");
  expect(
    JSON.parse(readFileSync(join(source, "termco-plugin.json"), "utf8"))
      .version,
  ).toBe("1.0.2");

  await app.close();
  const restarted = await electron.launch({
    args: [MAIN, workspace.dir],
    env: {
      ...process.env,
      TERMCO_USER_DATA: workspace.userData,
      TERMCO_E2E: "1",
      TERMCO_MCP_PORT: "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  try {
    const restartedPage = await restarted.firstWindow();
    await restartedPage
      .getByTestId("workspace")
      .waitFor({ state: "visible", timeout: 30_000 });
    const restartedCatalog = await restartedPage.evaluate(async () =>
      (await window.__termco.rendererPluginProfile()).catalog,
    );
    expect(
      restartedCatalog.find((plugin) => plugin.id === "e2e.ui-shell")
        ?.version,
    ).toBe("1.0.2");
    expect(
      restartedCatalog.find((plugin) => plugin.id === "ui-shell-native")
        ?.enabled,
    ).toBe(false);
  } finally {
    await restarted.close();
  }
});

// @termco-certifies fork plugin-manager-native source=src/renderer.tsx runtime=E2E_Search_plugins
test("Plugins: the Plugin Manager can fork itself without replacing the active manager", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Plugins", exact: true })
    .first()
    .click();
  const copy = settings.getByTestId(
    "profile-plugin-copy-plugin-manager-native",
  );
  await expect(copy).toBeVisible({ timeout: 15_000 });
  const initialProfileId = await settings.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).profileId
  );

  await settings.evaluate(() => {
    window.prompt = () => "e2e.plugin-manager";
  });
  await copy.dispatchEvent("click");

  await expect
    .poll(
      () =>
        settings.evaluate(async () =>
          (await window.__termco.listPluginDrafts()).some(
            (draft) => draft.id === "e2e.plugin-manager",
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  // Forking prepares editable source outside the selected profile. It must not
  // activate a duplicate settings contribution or remount the manager.
  await expect(
    settings.getByTestId("plugin-draft-e2e.plugin-manager"),
  ).toBeVisible({ timeout: 15_000 });
  const replacementProfile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(replacementProfile.profileId).toBe(initialProfileId);
  expect(replacementProfile.plugins.map((plugin) => plugin.id)).toContain(
    "plugin-manager-native",
  );
  expect(replacementProfile.plugins.map((plugin) => plugin.id)).not.toContain(
    "e2e.plugin-manager",
  );
  expect(
    replacementProfile.modules.map((module) => module.pluginId),
  ).not.toContain("e2e.plugin-manager");
  expect(replacementProfile.activationOrder).not.toContain("e2e.plugin-manager");
  expect(
    replacementProfile.catalog.find(
      (plugin) => plugin.id === "e2e.plugin-manager",
    ),
  ).toBeUndefined();

  const source = await settings.evaluate(async () => {
    const drafts = await window.__termco.listPluginDrafts();
    return drafts.find((draft) => draft.id === "e2e.plugin-manager")
      ?.sourceFolder;
  });
  expect(source).toBeDefined();
  expect(source).toContain(
    join("plugin-platform", "plugins", "e2e.plugin-manager"),
  );
  const replacementSource = source as string;
  expect(existsSync(join(replacementSource, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(replacementSource, "src", "catalog.ts"))).toBe(true);
  const manifest = JSON.parse(
    readFileSync(join(replacementSource, "termco-plugin.json"), "utf8"),
  ) as { id: string; forkedFrom: string; replaces?: string };
  expect(manifest).toMatchObject({
    id: "e2e.plugin-manager",
    forkedFrom: "plugin-manager-native",
  });
  expect(manifest.replaces).toBeUndefined();

  // The independent fork is visible as a prepared draft without replacing the
  // active manager. Applying it remains an explicit later operation.
  await expect(settings.getByTestId("installed-plugins")).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Open plugins folder", exact: true }),
  ).toBeVisible();
});

// @termco-certifies copy-replace about-native source=src/renderer.tsx runtime=E2E_Apache_2.0
test("About: real settings plugin consumes shared providers and remains live-replaceable", async ({
  app,
  page,
  workspace,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "About", exact: true })
    .first()
    .click();
  const about = settings.getByTestId("about-section");
  await expect(about).toBeVisible({ timeout: 15_000 });
  await expect(about).toContainText("app.termco");
  await expect(
    about.getByRole("button", { name: /Check for updates|You're up to date/ }),
  ).toBeVisible();

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(["desktop-native", "updater-native", "about-native"]),
  );
  expect(profile.modules.map((module) => module.pluginId)).toContain(
    "about-native",
  );
  expect(profile.activationOrder).toEqual(
    expect.arrayContaining(["desktop-native", "updater-native", "about-native"]),
  );

  const result = await settings.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "about-native",
      replacementId: "e2e.about",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.about");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  const rendererSource = readFileSync(renderer, "utf8");
  const editedRenderer = rendererSource.replace(
    '<span className="text-xs">Apache 2.0</span>',
    '<span className="text-xs">E2E Apache 2.0</span>',
  );
  expect(editedRenderer).not.toBe(rendererSource);
  writeFileSync(renderer, editedRenderer);
  const apply = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.about"),
  );
  expect(apply.status).toBe("replaced");

  await settings
    .getByRole("button", { name: "About", exact: true })
    .first()
    .click();
  await expect(settings.getByTestId("about-section")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    settings.getByText("E2E Apache 2.0", { exact: true }),
  ).toBeVisible();
  await expectWholeFolderReplacementSelected(
    settings,
    "about-native",
    "e2e.about",
  );

  await revertWholeFolderReplacement(settings, "about-native", "e2e.about");
  await settings
    .getByRole("button", { name: "About", exact: true })
    .first()
    .click();
  await expect(settings.getByText("Apache 2.0", { exact: true })).toBeVisible();
  await expect(
    settings.getByText("E2E Apache 2.0", { exact: true }),
  ).toHaveCount(0);
});

// @termco-certifies copy-replace editor-settings source=src/renderer.tsx runtime=E2E_Vim_description
test("Editor: real settings plugin persists through the shared provider and remains replaceable", async ({
  app,
  page,
  workspace,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings
    .getByRole("button", { name: "Editor", exact: true })
    .first()
    .click();

  const vimRow = settings
    .getByText("Vim mode", { exact: true })
    .locator("..")
    .locator("..");
  const vim = vimRow.getByRole("switch");
  const before = await vim.getAttribute("aria-checked");
  await vim.click();
  await expect
    .poll(() => vim.getAttribute("aria-checked"), { timeout: 5_000 })
    .not.toBe(before);

  await expect
    .poll(() =>
      settings.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "editor-settings",
          capability: "settings.preferences",
          method: "get",
          args: ["vimMode"],
        }),
      ),
    )
    .toBe(before !== "true");

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(["preferences-json", "editor-settings"]),
  );
  expect(profile.modules.map((module) => module.pluginId)).toContain(
    "editor-settings",
  );
  expect(profile.activationOrder).toEqual(
    expect.arrayContaining(["preferences-json", "editor-settings"]),
  );

  const result = await settings.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "editor-settings",
      replacementId: "e2e.editor-settings",
    }),
  );
  expect(result.status).toBe("replaced");

  await settings
    .getByRole("button", { name: "Editor", exact: true })
    .first()
    .click();
  await expect(settings.getByTestId("editor-settings-section")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    settings
      .getByText("Vim mode", { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("switch"),
  ).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.editor-settings",
  );
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  const renderer = join(source, "src", "renderer.tsx");
  const rendererSource = readFileSync(renderer, "utf8");
  const editedRenderer = rendererSource.replace(
    "Enable Vim keybindings in the code editor.",
    "E2E Vim keybindings in the code editor.",
  );
  expect(editedRenderer).not.toBe(rendererSource);
  writeFileSync(renderer, editedRenderer);
  const apply = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.editor-settings"),
  );
  expect(apply.status).toBe("replaced");
  await settings
    .getByRole("button", { name: "Editor", exact: true })
    .first()
    .click();
  await expect(
    settings.getByText("E2E Vim keybindings in the code editor.", {
      exact: true,
    }),
  ).toBeVisible();
  await expectWholeFolderReplacementSelected(
    settings,
    "editor-settings",
    "e2e.editor-settings",
  );

  await revertWholeFolderReplacement(
    settings,
    "editor-settings",
    "e2e.editor-settings",
  );
  await settings
    .getByRole("button", { name: "Editor", exact: true })
    .first()
    .click();
  await expect(
    settings.getByText("Enable Vim keybindings in the code editor.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    settings.getByText("E2E Vim keybindings in the code editor.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    settings
      .getByText("Vim mode", { exact: true })
      .locator("..")
      .locator("..")
      .getByRole("switch"),
  ).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
});

// @termco-certifies copy-replace general-settings source=src/renderer.tsx runtime=E2E_hidden_files_description
test("General: real settings plugin shares preferences and can be replaced whole", async ({
  app,
  page,
  workspace,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "General", exact: true }).first().click();
  const section = settings.getByTestId("general-settings-section");
  await expect(section).toBeVisible({ timeout: 15_000 });

  const hidden = settings
    .getByText("Show hidden files", { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("switch");
  const before = await hidden.getAttribute("aria-checked");
  await hidden.click();
  await expect.poll(() => settings.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "general-settings",
      capability: "settings.preferences",
      method: "get",
      args: ["showHidden"],
    }),
  )).toBe(before !== "true");

  const result = await settings.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "general-settings",
      replacementId: "e2e.general-settings",
    }),
  );
  expect(result.status).toBe("replaced");
  await settings.getByRole("button", { name: "General", exact: true }).first().click();
  await expect(settings.getByTestId("general-settings-section")).toBeVisible({ timeout: 15_000 });
  await expect(settings
    .getByText("Show hidden files", { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("switch"))
    .toHaveAttribute("aria-checked", before === "true" ? "false" : "true");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.general-settings");
  expect(existsSync(join(source, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  const renderer = join(source, "src", "renderer.tsx");
  const rendererSource = readFileSync(renderer, "utf8");
  const originalDescription =
    "Include dot-prefixed files and folders (.env, .gitignore, .config) in the file explorer and search.";
  const e2eDescription =
    "E2E include dot-prefixed files and folders in the file explorer and search.";
  const editedRenderer = rendererSource.replace(
    originalDescription,
    e2eDescription,
  );
  expect(editedRenderer).not.toBe(rendererSource);
  writeFileSync(renderer, editedRenderer);
  const apply = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.general-settings"),
  );
  expect(apply.status).toBe("replaced");
  await settings.getByRole("button", { name: "General", exact: true }).first().click();
  await expect(
    settings.getByText(e2eDescription, { exact: true }),
  ).toBeVisible();
  await expectWholeFolderReplacementSelected(
    settings,
    "general-settings",
    "e2e.general-settings",
  );

  await revertWholeFolderReplacement(
    settings,
    "general-settings",
    "e2e.general-settings",
  );
  await settings.getByRole("button", { name: "General", exact: true }).first().click();
  await expect(
    settings.getByText(originalDescription, { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByText(e2eDescription, { exact: true }),
  ).toHaveCount(0);
  await expect(settings
    .getByText("Show hidden files", { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("switch"))
    .toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
});

// @termco-certifies copy-replace languages-settings source=src/renderer.tsx runtime=E2E_Add_custom_server
test("Languages: real settings plugin consumes the typed shared LSP provider", async ({ app, page, workspace }) => {
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Languages", exact: true }).first().click();
  await expect(settings.getByTestId("languages-settings-section")).toBeVisible({ timeout: 15_000 });
  await expect(settings.getByRole("button", { name: "Add custom server" })).toBeVisible();

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(["lsp-native", "languages-settings"]),
  );
  expect(profile.modules.map((module) => module.pluginId)).toContain(
    "languages-settings",
  );
  expect(profile.activationOrder).toEqual(
    expect.arrayContaining(["lsp-native", "languages-settings"]),
  );

  const result = await settings.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "languages-settings",
    replacementId: "e2e.languages-settings",
  }));
  expect(result.status).toBe("replaced");
  await settings.getByRole("button", { name: "Languages", exact: true }).first().click();
  await expect(settings.getByTestId("languages-settings-section")).toBeVisible({ timeout: 15_000 });
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.languages-settings");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  const rendererSource = readFileSync(renderer, "utf8");
  const editedRenderer = rendererSource.replace(
    ">Add custom server</ui.Button>",
    ">E2E Add custom server</ui.Button>",
  );
  expect(editedRenderer).not.toBe(rendererSource);
  writeFileSync(renderer, editedRenderer);
  const apply = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.languages-settings"),
  );
  expect(apply.status).toBe("replaced");
  await settings.getByRole("button", { name: "Languages", exact: true }).first().click();
  await expect(
    settings.getByRole("button", { name: "E2E Add custom server" }),
  ).toBeVisible();
  await expectWholeFolderReplacementSelected(
    settings,
    "languages-settings",
    "e2e.languages-settings",
  );

  await revertWholeFolderReplacement(
    settings,
    "languages-settings",
    "e2e.languages-settings",
  );
  await settings.getByRole("button", { name: "Languages", exact: true }).first().click();
  await expect(
    settings.getByRole("button", { name: "Add custom server" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "E2E Add custom server" }),
  ).toHaveCount(0);
});

// @termco-certifies copy-replace terminal-settings source=src/renderer.tsx runtime=E2E_cursor_blinking
test("Terminal: real settings plugin consumes shared PTY, workspace, and preferences", async ({ app, page, workspace }) => {
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Terminal", exact: true }).first().click();
  await expect(settings.getByTestId("terminal-settings-section")).toBeVisible({ timeout: 15_000 });
  const blink = settings
    .getByText("Cursor blinking", { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("switch");
  const before = await blink.getAttribute("aria-checked");
  await blink.click();
  await expect.poll(() => settings.evaluate(() => window.__termco.capabilityCall({ consumerPluginId: "terminal-settings", capability: "settings.preferences", method: "get", args: ["terminalCursorBlink"] }))).toBe(before !== "true");

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  const terminalPluginIds = [
    "preferences-json",
    "pty-native",
    "workspace-native",
    "terminal-settings",
  ];
  expect(profile.plugins.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(terminalPluginIds),
  );
  expect(profile.modules.map((module) => module.pluginId)).toContain(
    "terminal-settings",
  );
  expect(profile.activationOrder).toEqual(
    expect.arrayContaining(terminalPluginIds),
  );

  const result = await settings.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({ pluginId: "terminal-settings", replacementId: "e2e.terminal-settings" }));
  expect(result.status).toBe("replaced");
  await settings.getByRole("button", { name: "Terminal", exact: true }).first().click();
  await expect(settings.getByTestId("terminal-settings-section")).toBeVisible({ timeout: 15_000 });
  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.terminal-settings");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  const rendererSource = readFileSync(renderer, "utf8");
  const editedRenderer = rendererSource.replace(
    'title="Cursor blinking"',
    'title="E2E cursor blinking"',
  );
  expect(editedRenderer).not.toBe(rendererSource);
  writeFileSync(renderer, editedRenderer);
  const apply = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.terminal-settings"),
  );
  expect(apply.status).toBe("replaced");
  await settings.getByRole("button", { name: "Terminal", exact: true }).first().click();
  await expect(
    settings.getByText("E2E cursor blinking", { exact: true }),
  ).toBeVisible();
  await expectWholeFolderReplacementSelected(
    settings,
    "terminal-settings",
    "e2e.terminal-settings",
  );

  await revertWholeFolderReplacement(
    settings,
    "terminal-settings",
    "e2e.terminal-settings",
  );
  await settings.getByRole("button", { name: "Terminal", exact: true }).first().click();
  await expect(
    settings.getByText("Cursor blinking", { exact: true }),
  ).toBeVisible();
  await expect(
    settings.getByText("E2E cursor blinking", { exact: true }),
  ).toHaveCount(0);
  await expect(settings
    .getByText("Cursor blinking", { exact: true })
    .locator("..")
    .locator("..")
    .getByRole("switch"))
    .toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
});

// @termco-certifies copy-replace theme-native source=src/themes/kanagawa.ts runtime=E2E_Kanagawa
// @termco-certifies copy-replace appearance-settings source=src/renderer.tsx runtime=E2E_Color_theme
test("Appearance: provider and settings UI are separate live-replaceable plugins", async ({ app, page, workspace }) => {
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await expect(settings.getByTestId("appearance-settings-section")).toBeVisible({ timeout: 15_000 });
  await settings.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.poll(() => settings.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  await expect(settings.getByText("Kanagawa", { exact: true })).toBeVisible();

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(["theme-native", "appearance-settings"]),
  );
  expect(profile.modules.map((module) => module.pluginId)).toEqual(
    expect.arrayContaining(["theme-native", "appearance-settings"]),
  );
  expect(profile.activationOrder).toEqual(
    expect.arrayContaining(["theme-native", "appearance-settings"]),
  );

  const providerResult = await settings.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "theme-native",
    replacementId: "e2e.theme-provider",
  }));
  expect(providerResult.status).toBe("replaced");
  const providerSource = join(workspace.userData, "plugin-platform", "plugins", "e2e.theme-provider");
  const kanagawa = join(providerSource, "src", "themes", "kanagawa.ts");
  expect(existsSync(join(providerSource, "src", "renderer.tsx"))).toBe(true);
  expect(existsSync(kanagawa)).toBe(true);
  const themeSource = readFileSync(kanagawa, "utf8");
  const editedTheme = themeSource.replace(
    'name: "Kanagawa"',
    'name: "E2E Kanagawa"',
  );
  expect(editedTheme).not.toBe(themeSource);
  writeFileSync(kanagawa, editedTheme);
  const providerReload = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.theme-provider"),
  );
  expect(providerReload.status).toBe("replaced");
  await settings.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await expect(settings.getByTestId("appearance-settings-section")).toBeVisible({ timeout: 15_000 });
  await expect(settings.getByText("E2E Kanagawa", { exact: true })).toBeVisible();
  await expect.poll(() => settings.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  await expectWholeFolderReplacementSelected(
    settings,
    "theme-native",
    "e2e.theme-provider",
  );

  await revertWholeFolderReplacement(
    settings,
    "theme-native",
    "e2e.theme-provider",
  );
  await settings.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await expect(settings.getByText("Kanagawa", { exact: true })).toBeVisible();
  await expect(settings.getByText("E2E Kanagawa", { exact: true })).toHaveCount(0);
  await expect.poll(() => settings.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

  const settingsResult = await settings.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "appearance-settings",
    replacementId: "e2e.appearance-settings",
  }));
  expect(settingsResult.status).toBe("replaced");
  const settingsSource = join(workspace.userData, "plugin-platform", "plugins", "e2e.appearance-settings");
  const settingsRenderer = join(settingsSource, "src", "renderer.tsx");
  expect(existsSync(settingsRenderer)).toBe(true);
  expect(existsSync(join(settingsSource, "src", "editorThemes.ts"))).toBe(true);
  const settingsRendererSource = readFileSync(settingsRenderer, "utf8");
  const editedSettingsRenderer = settingsRendererSource.replace(
    'label="Color theme"',
    'label="E2E Color theme"',
  );
  expect(editedSettingsRenderer).not.toBe(settingsRendererSource);
  writeFileSync(settingsRenderer, editedSettingsRenderer);
  const settingsReload = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.appearance-settings"),
  );
  expect(settingsReload.status).toBe("replaced");
  await settings.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await expect(settings.getByTestId("appearance-settings-section")).toBeVisible({ timeout: 15_000 });
  await expect(settings.getByText("E2E Color theme", { exact: true })).toBeVisible();
  await expectWholeFolderReplacementSelected(
    settings,
    "appearance-settings",
    "e2e.appearance-settings",
  );

  await revertWholeFolderReplacement(
    settings,
    "appearance-settings",
    "e2e.appearance-settings",
  );
  await settings.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await expect(settings.getByText("Color theme", { exact: true })).toBeVisible();
  await expect(settings.getByText("E2E Color theme", { exact: true })).toHaveCount(0);
});

// @termco-certifies copy-replace models-native source=src/models.ts runtime=E2E_Registry_Model
// @termco-certifies copy-replace models-settings source=src/renderer.tsx runtime=E2E_Model_sources
test("Models: registry provider and complete settings workflow are live-replaceable", async ({ app, page, workspace }) => {
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Models", exact: true }).first().click();
  await expect(settings.getByTestId("models-settings-section")).toBeVisible({ timeout: 15_000 });
  await expect(settings.getByText("Model sources", { exact: true })).toBeVisible();

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(["models-native", "models-settings"]),
  );
  expect(profile.modules.map((module) => module.pluginId)).toEqual(
    expect.arrayContaining(["models-native", "models-settings"]),
  );
  expect(profile.activationOrder).toEqual(
    expect.arrayContaining(["models-native", "models-settings"]),
  );

  const providerResult = await settings.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "models-native",
    replacementId: "e2e.models-provider",
  }));
  expect(providerResult.status).toBe("replaced");

  const providerSource = join(workspace.userData, "plugin-platform", "plugins", "e2e.models-provider");
  const modelsSource = join(providerSource, "src", "models.ts");
  writeFileSync(modelsSource, readFileSync(modelsSource, "utf8").replace('label: "GPT-5.6"', 'label: "E2E Registry Model"'));
  const apply = await settings.evaluate(() => window.__termco.applyPlugin("e2e.models-provider"));
  expect(apply.status).toBe("replaced");

  await settings.getByRole("button", { name: "Models", exact: true }).first().click();
  const defaultModelRow = settings
    .getByText("Model used for new chats", { exact: true })
    .locator("..")
    .locator("..");
  await defaultModelRow.getByRole("button").click();
  await expect(
    settings.getByRole("button", { name: /E2E Registry Model/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await settings.keyboard.press("Escape");

  // The still-migrating chat UI reads the live registry adapter too; it must
  // see edits from the copied provider instead of a bundled fallback list.
  await page.keyboard.press("Escape");
  await openAiConversation(page);
  const modelTrigger = page.getByRole("button", { name: /GPT|Claude|model/i }).filter({ has: page.locator("svg") }).last();
  await modelTrigger.click();
  const browser = page.getByRole("dialog").last();
  await expect(browser.getByRole("menuitem", { name: /E2E Registry Model/ })).toBeVisible({ timeout: 10_000 });
  await expectWholeFolderReplacementSelected(
    page,
    "models-native",
    "e2e.models-provider",
  );
  await page.keyboard.press("Escape");

  expect(existsSync(join(providerSource, "src", "renderer.ts"))).toBe(true);
  expect(existsSync(join(providerSource, "src", "providers.ts"))).toBe(true);
  expect(existsSync(join(providerSource, "src", "models.ts"))).toBe(true);
  await revertWholeFolderReplacement(
    page,
    "models-native",
    "e2e.models-provider",
  );

  if (!(await page.getByTestId("settings-view").isVisible())) {
    await openSettingsWindow(app, page);
  }
  await page.getByRole("button", { name: "Models", exact: true }).first().click();
  const restoredDefaultModelRow = page
    .getByText("Model used for new chats", { exact: true })
    .locator("..")
    .locator("..");
  await restoredDefaultModelRow.getByRole("button").click();
  await expect(
    page.getByRole("button", { name: /GPT-5\.6/ }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /E2E Registry Model/ }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  const settingsResult = await page.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "models-settings",
    replacementId: "e2e.models-settings",
  }));
  expect(settingsResult.status).toBe("replaced");
  const settingsSource = join(workspace.userData, "plugin-platform", "plugins", "e2e.models-settings");
  const settingsRenderer = join(settingsSource, "src", "renderer.tsx");
  expect(existsSync(settingsRenderer)).toBe(true);
  const settingsRendererSource = readFileSync(settingsRenderer, "utf8");
  const editedSettingsRenderer = settingsRendererSource.replace(
    '<div className="termco-section-label">Model sources</div>',
    '<div className="termco-section-label">E2E Model sources</div>',
  );
  expect(editedSettingsRenderer).not.toBe(settingsRendererSource);
  writeFileSync(settingsRenderer, editedSettingsRenderer);
  const settingsReload = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.models-settings"),
  );
  expect(settingsReload.status).toBe("replaced");
  await page.getByRole("button", { name: "Models", exact: true }).first().click();
  await expect(page.getByTestId("models-settings-section")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("E2E Model sources", { exact: true })).toBeVisible();
  await expectWholeFolderReplacementSelected(
    page,
    "models-settings",
    "e2e.models-settings",
  );

  await revertWholeFolderReplacement(
    page,
    "models-settings",
    "e2e.models-settings",
  );
  await page.getByRole("button", { name: "Models", exact: true }).first().click();
  await expect(page.getByText("Model sources", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E Model sources", { exact: true })).toHaveCount(0);
});

// @termco-certifies copy-replace shortcuts-native source=src/model.ts runtime=E2E_New_tab
// @termco-certifies copy-replace shortcuts-settings source=src/renderer.tsx runtime=E2E_Filter_shortcuts
test("Shortcuts: provider and settings UI are separate live-replaceable plugins", async ({ app, page, workspace }) => {
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Shortcuts", exact: true }).first().click();
  const section = settings.getByTestId("shortcuts-settings-section");
  await expect(section).toBeVisible({ timeout: 15_000 });
  await expect(settings.getByText("Tabs", { exact: true })).toBeVisible();

  const filter = settings.getByRole("textbox", { name: "Filter shortcuts" });
  await filter.fill("new tab");
  const newTabRow = settings
    .getByText("New tab", { exact: true })
    .locator("..")
    .locator("..");
  await expect(newTabRow).toBeVisible();
  await newTabRow.getByTitle("Clear shortcut").click();
  await expect(settings.getByText("Unassigned", { exact: true })).toBeVisible();
  await expect.poll(() => settings.evaluate(() => window.__termco.capabilityCall({
    consumerPluginId: "shortcuts-native",
    capability: "settings.preferences",
    method: "get",
    args: ["shortcuts"],
  }))).toMatchObject({ "tab.new": [] });

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toEqual(
    expect.arrayContaining(["shortcuts-native", "shortcuts-settings"]),
  );
  expect(profile.modules.map((module) => module.pluginId)).toEqual(
    expect.arrayContaining(["shortcuts-native", "shortcuts-settings"]),
  );
  expect(profile.activationOrder).toEqual(
    expect.arrayContaining(["shortcuts-native", "shortcuts-settings"]),
  );

  const providerResult = await settings.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "shortcuts-native",
    replacementId: "e2e.shortcuts-provider",
  }));
  expect(providerResult.status).toBe("replaced");
  const providerSource = join(workspace.userData, "plugin-platform", "plugins", "e2e.shortcuts-provider");
  const providerModel = join(providerSource, "src", "model.ts");
  expect(existsSync(providerModel)).toBe(true);
  expect(existsSync(join(providerSource, "src", "renderer.ts"))).toBe(true);
  const providerModelSource = readFileSync(providerModel, "utf8");
  const editedProviderModel = providerModelSource.replace(
    'id: "tab.new", label: "New tab"',
    'id: "tab.new", label: "E2E New tab"',
  );
  expect(editedProviderModel).not.toBe(providerModelSource);
  writeFileSync(providerModel, editedProviderModel);
  const providerReload = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.shortcuts-provider"),
  );
  expect(providerReload.status).toBe("replaced");
  await settings.getByRole("button", { name: "Shortcuts", exact: true }).first().click();
  await settings.getByRole("textbox", { name: "Filter shortcuts" }).fill("E2E New tab");
  await expect(settings.getByText("E2E New tab", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(settings.getByText("Unassigned", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expectWholeFolderReplacementSelected(
    settings,
    "shortcuts-native",
    "e2e.shortcuts-provider",
  );

  await revertWholeFolderReplacement(
    settings,
    "shortcuts-native",
    "e2e.shortcuts-provider",
  );
  await settings.getByRole("button", { name: "Shortcuts", exact: true }).first().click();
  await settings.getByRole("textbox", { name: "Filter shortcuts" }).fill("new tab");
  await expect(settings.getByText("New tab", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(settings.getByText("E2E New tab", { exact: true })).toHaveCount(0);
  await expect(settings.getByText("Unassigned", { exact: true })).toBeVisible();

  const settingsResult = await settings.evaluate(() => window.__termcoE2E.copyAndReplacePluginThroughPlan({
    pluginId: "shortcuts-settings",
    replacementId: "e2e.shortcuts-settings",
  }));
  expect(settingsResult.status).toBe("replaced");
  await settings.getByRole("button", { name: "Shortcuts", exact: true }).first().click();
  await expect(settings.getByTestId("shortcuts-settings-section")).toBeVisible({ timeout: 15_000 });

  const settingsSource = join(workspace.userData, "plugin-platform", "plugins", "e2e.shortcuts-settings");
  const settingsRenderer = join(settingsSource, "src", "renderer.tsx");
  expect(existsSync(settingsRenderer)).toBe(true);
  expect(existsSync(join(settingsSource, "src", "filter.ts"))).toBe(true);
  const settingsRendererSource = readFileSync(settingsRenderer, "utf8");
  const editedSettingsRenderer = settingsRendererSource.replace(
    'placeholder="Filter shortcuts…"',
    'placeholder="E2E Filter shortcuts…"',
  );
  expect(editedSettingsRenderer).not.toBe(settingsRendererSource);
  writeFileSync(settingsRenderer, editedSettingsRenderer);
  const settingsReload = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.shortcuts-settings"),
  );
  expect(settingsReload.status).toBe("replaced");
  await settings.getByRole("button", { name: "Shortcuts", exact: true }).first().click();
  await expect(settings.getByPlaceholder("E2E Filter shortcuts…")).toBeVisible();
  await expectWholeFolderReplacementSelected(
    settings,
    "shortcuts-settings",
    "e2e.shortcuts-settings",
  );

  await revertWholeFolderReplacement(
    settings,
    "shortcuts-settings",
    "e2e.shortcuts-settings",
  );
  await settings.getByRole("button", { name: "Shortcuts", exact: true }).first().click();
  await expect(settings.getByPlaceholder("Filter shortcuts…")).toBeVisible();
  await expect(settings.getByPlaceholder("E2E Filter shortcuts…")).toHaveCount(0);
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, openSettingsWindow, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace settings-native source=src/renderer.tsx runtime=E2E_replacement_settings
test("settings is categorized, explanation-searchable, source-owned, and replaces live", async ({
  app,
  page,
  workspace,
}) => {
  const settings = await openSettingsWindow(app, page);
  const view = settings.getByTestId("settings-view");
  await expect(view).toHaveAttribute("data-source-plugin", "settings-native");
  await expect(
    settings.getByRole("navigation", { name: "Settings categories" }),
  ).toContainText("System");
  await expect(
    settings.getByRole("navigation", { name: "Settings categories" }),
  ).toContainText("Workspace");

  const search = settings.getByLabel("Search settings");
  await search.fill("automatically when you sign in");
  await expect(
    settings.getByRole("button", { name: /Launch at login.*General/i }),
  ).toContainText("Open Termco automatically when you sign in.");
  await search.fill("");

  const profile = await settings.evaluate(() =>
    window.__termco.rendererPluginProfile(),
  );
  expect(profile.plugins.map((plugin) => plugin.id)).toContain(
    "settings-native",
  );
  expect(profile.modules.map((module) => module.pluginId)).toContain(
    "settings-native",
  );
  expect(profile.activationOrder).toContain("settings-native");

  const result = await settings.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "settings-native",
      replacementId: "e2e.settings",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(workspace.userData, "plugin-platform", "plugins", "e2e.settings");
  const renderer = join(source, "src", "renderer.tsx");
  expect(existsSync(renderer)).toBe(true);
  expect(existsSync(join(source, "src", "state.ts"))).toBe(true);
  expect(existsSync(join(source, "src", "model.ts"))).toBe(true);
  writeFileSync(
    renderer,
    readFileSync(renderer, "utf8").replace(
      "Search settings…",
      "E2E replacement settings…",
    ),
  );

  const apply = await settings.evaluate(() =>
    window.__termco.applyPlugin("e2e.settings"),
  );
  expect(apply.status).toBe("replaced");
  const replacement = await openSettingsWindow(app, page);
  await expect(replacement.getByLabel("Search settings")).toHaveAttribute(
    "placeholder",
    "E2E replacement settings…",
  );
  await expectWholeFolderReplacementSelected(
    replacement,
    "settings-native",
    "e2e.settings",
  );

  await revertWholeFolderReplacement(
    replacement,
    "settings-native",
    "e2e.settings",
  );
  // The original provider's live state is restored too, so the already-open
  // Settings view remains open. Clicking the header again would close it.
  await expect(replacement.getByTestId("settings-view")).toBeVisible();
  await expect(replacement.getByLabel("Search settings")).toHaveAttribute(
    "placeholder",
    "Search settings…",
  );
});

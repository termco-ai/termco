import type { Page } from "@playwright/test";
import { collectErrors, expect, openSettingsWindow, test } from "./fixtures";

// This matrix proves the post-confirmation transaction for providers that own
// live resources. Cancellation and unchanged-profile behavior are covered by
// the dedicated Plugin Manager interaction below.
process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

async function setEnabled(page: Page, pluginId: string, enabled: boolean) {
  return page.evaluate(async ({ id, next }) => {
    const impact = await window.__termco.previewPluginEnabled(id, next);
    const result = await window.__termco.setPluginEnabled(id, next, {
      previewId: impact.previewId,
      generation: impact.generation,
    });
    return { impact, result };
  }, { id: pluginId, next: enabled });
}

test("every selected base plugin deactivates and restores its runtime contribution", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  const { errors } = collectErrors(page);
  await page.getByTestId("workspace").evaluate((element) => {
    element.setAttribute("data-full-deactivation-matrix-sentinel", "preserved");
  });
  await page.getByTestId("core-shell").evaluate((element) => {
    element.setAttribute("data-full-shell-sentinel", "preserved");
  });
  const catalog = await page.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog,
  );
  expect(catalog.length).toBeGreaterThanOrEqual(100);

  const toggled: string[] = [];
  const protectedPlugins: string[] = [];
  const selectedPluginId = process.env.TERMCO_E2E_PLUGIN_MATRIX_TARGET;
  for (const plugin of catalog) {
    if (plugin.enabled === false || plugin.profileRelation !== "inherited") {
      continue;
    }
    if (selectedPluginId && plugin.id !== selectedPluginId) continue;
    let stage = "preview disable";
    let impactSummary = "";
    try {
      const impact = await page.evaluate((id) =>
        window.__termco.previewPluginEnabled(id, false), plugin.id,
      );
      impactSummary = JSON.stringify({
        blockedPlugins: impact.blockedPlugins,
        unavailableFeatures: impact.unavailableFeatures,
        degradedPlugins: impact.degradedPlugins,
      });
      expect(impact).toMatchObject({
        pluginId: plugin.id,
        enabled: false,
        blockedPlugins: expect.any(Array),
        unavailableFeatures: expect.any(Array),
        degradedPlugins: expect.any(Array),
        destructiveResources: expect.any(Array),
      });

      stage = "disable";
      const disabled = await page.evaluate(async ({ id, previewId, generation }) =>
        window.__termco.setPluginEnabled(id, false, { previewId, generation }),
      {
        id: plugin.id,
        previewId: impact.previewId,
        generation: impact.generation,
      });
      expect(disabled).toMatchObject({
        status: "replaced",
        pluginId: plugin.id,
        enabled: false,
      });

      stage = "inspect disabled graph";
      const withoutPlugin = await page.evaluate(async (id) => {
        const profile = await window.__termco.rendererPluginProfile();
        return {
          row: profile.catalog.find((entry) => entry.id === id),
          inActivationOrder: profile.activationOrder.includes(id),
          hasModule: profile.modules.some((entry) => entry.pluginId === id),
        };
      }, plugin.id);
      expect(withoutPlugin.row).toMatchObject({
        id: plugin.id,
        enabled: false,
        status: "disabled",
        runtime: [],
      });
      if (plugin.processes.includes("renderer")) {
        expect(withoutPlugin.inActivationOrder, plugin.id).toBe(false);
        expect(withoutPlugin.hasModule, plugin.id).toBe(false);
      }
      stage = "verify shell after disable";
      const shellDiagnostics = await page.evaluate(() => ({
        sentinel: document.querySelectorAll(
          '[data-full-shell-sentinel="preserved"]',
        ).length,
        root: document.querySelector("#root")?.innerHTML.slice(0, 1_000) ?? "",
      }));
      if (shellDiagnostics.sentinel !== 1) {
        throw new Error(
          `shell disappeared: ${JSON.stringify({ ...shellDiagnostics, errors })}`,
        );
      }
      await expect(page.locator(
        '[data-full-shell-sentinel="preserved"]',
      )).toHaveCount(1);
      await expect(page.locator(
        '[data-full-deactivation-matrix-sentinel="preserved"]',
      )).toHaveCount(1);

      stage = "preview restore";
      const enableImpact = await page.evaluate((id) =>
        window.__termco.previewPluginEnabled(id, true), plugin.id,
      );
      stage = "restore";
      const restored = await page.evaluate(
        async ({ id, previewId, generation }) =>
          window.__termco.setPluginEnabled(id, true, { previewId, generation }),
        {
          id: plugin.id,
          previewId: enableImpact.previewId,
          generation: enableImpact.generation,
        },
      );
      expect(restored).toMatchObject({
        status: "replaced",
        pluginId: plugin.id,
        enabled: true,
      });
      stage = "inspect restored graph";
      const withPlugin = await page.evaluate(async (id) => {
        const profile = await window.__termco.rendererPluginProfile();
        return {
          row: profile.catalog.find((entry) => entry.id === id),
          inActivationOrder: profile.activationOrder.includes(id),
          hasModule: profile.modules.some((entry) => entry.pluginId === id),
        };
      }, plugin.id);
      expect(withPlugin.row?.enabled, plugin.id).toBe(true);
      expect(withPlugin.row?.status, plugin.id).toMatch(/^active/);
      if (plugin.processes.includes("renderer")) {
        expect(withPlugin.inActivationOrder, plugin.id).toBe(true);
        expect(withPlugin.hasModule, plugin.id).toBe(true);
      }
      stage = "verify shell after restore";
      await expect(page.locator(
        '[data-full-shell-sentinel="preserved"]',
      )).toHaveCount(1);
      await expect(page.locator(
        '[data-full-deactivation-matrix-sentinel="preserved"]',
      )).toHaveCount(1);
      toggled.push(plugin.id);
    } catch (error) {
      if (/cannot be disabled/i.test(String(error))) {
        protectedPlugins.push(plugin.id);
        continue;
      }
      throw new Error(
        `deactivation matrix failed for ${plugin.id} during ${stage} (${impactSummary}): ${String(error)}`,
      );
    }
  }

  if (selectedPluginId) {
    expect([...toggled, ...protectedPlugins]).toEqual([selectedPluginId]);
  } else {
    expect(toggled.length).toBeGreaterThanOrEqual(90);
    expect(protectedPlugins.sort()).toEqual([
      "plugin-manager-native",
      "settings-native",
      "ui-shell-native",
      "workspace-shell-native",
    ]);
  }
});

test("representative leaf, UI, tool, and provider plugins disable and restore without remounting the shell", async ({
  page,
}) => {
  await page.getByTestId("workspace").evaluate((element) => {
    element.setAttribute("data-deactivation-matrix-sentinel", "preserved");
  });
  const tabCount = await page.getByRole("tab").count();

  for (const pluginId of [
    "skills-panel-native",
    "statusbar-native",
    "ai-tools-browser-native",
    "git-native",
  ]) {
    const disabled = await setEnabled(page, pluginId, false);
    expect(disabled.result).toMatchObject({
      status: "replaced",
      pluginId,
      enabled: false,
    });
    await expect(page.locator(
      '[data-deactivation-matrix-sentinel="preserved"]',
    )).toHaveCount(1);
    await expect(page.getByTestId("workspace")).toBeVisible();
    expect(await page.getByRole("tab").count()).toBe(tabCount);
    expect(await page.evaluate(async (id) =>
      (await window.__termco.rendererPluginProfile()).catalog.find(
        (plugin) => plugin.id === id,
      )?.enabled, pluginId,
    )).toBe(false);

    const restored = await setEnabled(page, pluginId, true);
    expect(restored.result).toMatchObject({
      status: "replaced",
      pluginId,
      enabled: true,
    });
    await expect(page.locator(
      '[data-deactivation-matrix-sentinel="preserved"]',
    )).toHaveCount(1);
    expect(await page.evaluate(async (id) =>
      (await window.__termco.rendererPluginProfile()).catalog.find(
        (plugin) => plugin.id === id,
      )?.status, pluginId,
    )).toMatch(/^active/);
  }
});

test("dependency-impact messaging can be cancelled without mutating the profile", async ({
  app,
  page,
}) => {
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "Plugins", exact: true }).click();
  const git = settings.getByTestId("profile-plugin-row-git-native");
  await git.getByRole("button", { name: "Deactivate" }).click();
  const impact = settings.getByTestId("profile-plugin-impact-git-native");
  await expect(impact).toBeVisible();
  await expect(impact).toContainText(/dependent parts|cannot start|hide or pause/i);
  await impact.getByRole("button", { name: "Keep active" }).click();
  await expect(impact).toHaveCount(0);
  expect(await settings.evaluate(async () =>
    (await window.__termco.rendererPluginProfile()).catalog.find(
      (plugin) => plugin.id === "git-native",
    )?.enabled,
  )).toBe(true);
});

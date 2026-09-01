import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { MAIN, MOD, openSettingsWindow, seedWorkspace } from "./fixtures";
import { copyAndReplacePluginThroughPlan } from "./helpers";

function launchEnvironment(userData: string, extra: Record<string, string>) {
  return {
    ...process.env,
    TERMCO_USER_DATA: userData,
    TERMCO_E2E: "1",
    TERMCO_MCP_PORT: "0",
    TERMCO_E2E_AUTO_CONFIRM_UNINSTALL: "1",
    VITE_DEV_SERVER_URL: "",
    ...extra,
  };
}

async function readyPage(app: Awaited<ReturnType<typeof electron.launch>>) {
  const page = await app.firstWindow({ timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("sidebar").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 30_000 });
  await page.keyboard.press("Escape");
  return page;
}

test("exports a named customized company profile and imports it with onboarding in fresh user data", async () => {
  const packageDirectory = mkdtempSync(join(tmpdir(), "termco-profile-e2e-"));
  const packagePath = join(packageDirectory, "acme-developer-1.0.0.termco-profile.zip");
  const sourceWorkspace = seedWorkspace();
  const sourceApp = await electron.launch({
    args: [MAIN, sourceWorkspace.dir],
    env: launchEnvironment(sourceWorkspace.userData, {
      TERMCO_E2E_PROFILE_EXPORT_PATH: packagePath,
    }),
  });

  try {
    const page = await readyPage(sourceApp);
    await page.keyboard.press(`${MOD}+Shift+o`);
    await expect(page.getByText("Nothing to preview yet", { exact: true })).toBeVisible();
    await page.evaluate(() => window.__termco.capabilityCall({
      consumerPluginId: "general-settings",
      capability: "settings.preferences",
      method: "set",
      args: ["zoomLevel", 1.25],
    }));
    const replacement = await copyAndReplacePluginThroughPlan(page, {
      pluginId: "preview-surface-native",
      replacementId: "company.preview-surface",
      name: "Acme Preview",
    });
    expect(replacement.status).toBe("replaced");
    const source = join(
      sourceWorkspace.userData,
      "plugin-platform",
      "plugins",
      "company.preview-surface",
      "src",
      "renderer.tsx",
    );
    const implementation = readFileSync(source, "utf8");
    writeFileSync(
      source,
      implementation.replace("Nothing to preview yet", "Acme preview is ready"),
    );
    const applied = await page.evaluate(() =>
      window.__termco.applyPlugin("company.preview-surface")
    );
    expect(applied.status).toBe("replaced");
    await expect(page.getByText("Acme preview is ready", { exact: true })).toBeVisible();

    const settings = await openSettingsWindow(sourceApp, page);
    await settings.getByRole("button", { name: "Profiles", exact: true }).click();
    await settings.getByTestId("profile-export-name").fill("Acme Developer");
    await settings.getByLabel("Profile version").fill("1.0.0");
    await settings.getByPlaceholder("Our recommended Termco setup for product development.")
      .fill("Acme's product development setup.");
    await settings.getByTestId("profile-export").click();
    await expect(settings.getByText(/Exported Acme Developer 1.0.0/)).toBeVisible({ timeout: 20_000 });
    expect(existsSync(packagePath)).toBe(true);
    const archive = readFileSync(packagePath);
    expect(archive.includes(Buffer.from("sk-e2e-placeholder-not-a-real-key"))).toBe(false);
    const entries = unzipSync(archive);
    expect(JSON.parse(strFromU8(entries["profile/defaults.json"]!))).toMatchObject({
      values: { zoomLevel: 1.25 },
    });
    expect(strFromU8(entries["plugins/company.preview-surface/src/renderer.tsx"]!))
      .toContain("Acme preview is ready");
  } finally {
    await sourceApp.close();
  }

  const destinationWorkspace = seedWorkspace();
  const destinationApp = await electron.launch({
    args: [MAIN, destinationWorkspace.dir],
    env: launchEnvironment(destinationWorkspace.userData, {
      TERMCO_E2E_PROFILE_IMPORT_PATH: packagePath,
    }),
  });
  try {
    const page = await readyPage(destinationApp);
    const settings = await openSettingsWindow(destinationApp, page);
    await settings.getByRole("button", { name: "Profiles", exact: true }).click();
    await settings.getByTestId("profile-import").click();
    await expect(settings.getByText(/Imported Acme Developer 1.0.0/)).toBeVisible({ timeout: 30_000 });
    const imported = settings.getByTestId("profile-row-imported.company.acme-developer.1.0.0");
    await expect(imported).toContainText(/\d+ plugins/);
    await expect(imported).toContainText("1 company source folder");
    await imported.getByRole("button", { name: "Activate" }).click();
    await expect(imported.getByText("Active", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.__termco.capabilityCall({
      consumerPluginId: "general-settings",
      capability: "settings.preferences",
      method: "get",
      args: ["zoomLevel"],
    }))).toBe(1.25);

    await page.keyboard.press("Escape");
    await page.keyboard.press(`${MOD}+Shift+o`);
    await expect(page.getByText("Acme preview is ready", { exact: true })).toBeVisible({ timeout: 20_000 });

    const reopened = await openSettingsWindow(destinationApp, page);
    await reopened.getByRole("button", { name: "Getting started", exact: true }).click();
    await expect(reopened.getByText("Adapt Termco for your company")).toBeVisible();
  } finally {
    await destinationApp.close();
  }
});

import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAIN, seedWorkspace } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// @termco-certifies copy-replace boot-diagnostics-native source=src/main.ts runtime=E2E_boot_diagnostics
// @termco-certifies copy-replace safe-recovery-native source=src/renderer.tsx runtime=E2E_Recovery_Plugin
test("a broken selected profile boots protected recovery UI and restores the default live", async () => {
  const workspace = seedWorkspace();
  const brokenProfileDirectory = join(
    workspace.userData,
    "plugin-platform",
    "profiles",
    "broken-user",
  );
  mkdirSync(brokenProfileDirectory, { recursive: true });
  writeFileSync(
    join(brokenProfileDirectory, "profile.json"),
    JSON.stringify({
      schemaVersion: 3,
      id: "broken.user",
      bundles: [],
      plugins: [
        {
          id: "missing-plugin",
          module: join(workspace.userData, "missing-plugin"),
        },
      ],
      patches: [],
    }),
  );
  mkdirSync(join(workspace.userData, "plugin-platform"), { recursive: true });
  writeFileSync(
    join(workspace.userData, "plugin-platform", "active-profile.json"),
    JSON.stringify({ profileId: "broken.user" }),
  );

  const app = await electron.launch({
    args: [MAIN, workspace.dir],
    env: {
      ...process.env,
      TERMCO_USER_DATA: workspace.userData,
      TERMCO_E2E: "1",
      TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT: "1",
      TERMCO_E2E_AUTO_CONFIRM_UNINSTALL: "1",
      TERMCO_MCP_PORT: "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    const recovery = page.getByTestId("safe-profile-recovery");
    await expect(recovery).toBeVisible({ timeout: 30_000 });
    await expect(recovery).toContainText("broken.user");
    await expect(recovery).toContainText("missing-plugin");

    const replaceSource = async (
      originalPluginId: string,
      replacementId: string,
      relativePath: string,
      edit: (source: string) => string,
    ) => {
      const copied = await page.evaluate(
        ({ pluginId, nextId }) =>
          window.__termcoE2E.copyAndReplacePluginThroughPlan({
            pluginId,
            replacementId: nextId,
          }),
        { pluginId: originalPluginId, nextId: replacementId },
      );
      expect(copied.status).toBe("replaced");
      const file = join(
        workspace.userData,
        "plugin-platform",
        "plugins",
        replacementId,
        relativePath,
      );
      expect(existsSync(file)).toBe(true);
      const source = readFileSync(file, "utf8");
      const edited = edit(source);
      expect(edited).not.toBe(source);
      writeFileSync(file, edited);
      const reloaded = await page.evaluate(
        (pluginId) => window.__termco.applyPlugin(pluginId),
        replacementId,
      );
      expect(reloaded.status).toBe("replaced");
    };

    await replaceSource(
      "boot-diagnostics-native",
      "e2e.boot-diagnostics",
      "src/main.ts",
      (source) =>
        source.replace(
          "async read() {",
          'async read() {\n        return { requestedProfileId: "e2e.broken", recoveryProfileId: "termco.safe-recovery", phase: "profile-boot", message: "E2E boot diagnostics", at: "2026-08-21T00:00:00.000Z" };',
        ),
    );
    await expect(recovery).toContainText("E2E boot diagnostics");
    await expectWholeFolderReplacementSelected(
      page,
      "boot-diagnostics-native",
      "e2e.boot-diagnostics",
    );
    await revertWholeFolderReplacement(
      page,
      "boot-diagnostics-native",
      "e2e.boot-diagnostics",
    );
    await expect(recovery).toContainText("broken.user");

    await replaceSource(
      "safe-recovery-native",
      "e2e.safe-recovery",
      "src/renderer.tsx",
      (source) =>
        source.replace(
          "Recovery profile is active",
          "E2E Recovery Plugin is active",
        ),
    );
    await expect(recovery).toContainText("E2E Recovery Plugin is active");
    await expectWholeFolderReplacementSelected(
      page,
      "safe-recovery-native",
      "e2e.safe-recovery",
    );
    await revertWholeFolderReplacement(
      page,
      "safe-recovery-native",
      "e2e.safe-recovery",
    );
    await expect(recovery).toContainText("Recovery profile is active");
    await expect(recovery).not.toContainText("E2E Recovery Plugin is active");

    await recovery.getByRole("button", { name: "Open Plugin Manager" }).click();
    await expect(page.getByTestId("plugin-search")).toBeVisible();

    await recovery
      .getByRole("button", { name: "Restore Default Profile" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.__termco.rendererPluginProfile()).profileId,
        ),
      )
      .toBe("termco.default");
    await expect(recovery).toHaveCount(0, { timeout: 30_000 });
    const ids = await page.evaluate(async () =>
      (await window.__termco.rendererPluginProfile()).plugins.map(
        (plugin) => plugin.id,
      ),
    );
    expect(ids).toContain("statusbar-native");
    expect(ids).not.toContain("safe-recovery-native");
    expect(
      JSON.parse(
        readFileSync(
          join(
            workspace.userData,
            "plugin-platform",
            "active-profile.json",
          ),
          "utf8",
        ),
      ).profileId,
    ).toBe("termco.default");
  } finally {
    await app.close();
  }
});

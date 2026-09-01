import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAIN, seedWorkspace } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  openCommandPalette,
  revertWholeFolderReplacement,
} from "./helpers";

test("company profile replaces providers and UI, removes a feature, and adds a command", async () => {
  const workspace = seedWorkspace();
  const app = await electron.launch({
    args: [MAIN, workspace.dir],
    env: {
      ...process.env,
      TERMCO_PROFILE: "company.example",
      TERMCO_USER_DATA: workspace.userData,
      TERMCO_E2E: "1",
      TERMCO_MCP_PORT: "0",
      VITE_DEV_SERVER_URL: "",
    },
  });
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    await page
      .getByTestId("workspace")
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.getByTestId("company-example-statusbar")).toContainText(
      "Example Company",
    );

    const catalog = await page.evaluate(async () =>
      (await window.__termco.rendererPluginProfile()).catalog,
    );
    const ids = catalog.map((plugin) => plugin.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "company-example-command",
        "company-example-http",
        "company-example-statusbar",
      ]),
    );
    for (const id of [
      "http-native",
      "statusbar-native",
      "trajectory-native",
    ]) {
      expect(catalog.find((plugin) => plugin.id === id)).toMatchObject({
        id,
        enabled: false,
        status: "disabled",
      });
    }

    await page.evaluate(() => {
      window.addEventListener(
        "termco:company-example-ping",
        () => document.body.setAttribute("data-company-ping", "received"),
        { once: true },
      );
    });
    const palette = page.getByPlaceholder("Search or run a command…");
    await palette.fill("Example Company: Ping");
    const command = page.getByText("Example Company: Ping", { exact: true });
    await expect(command).toBeVisible();
    await command.click();
    await expect(page.locator("body")).toHaveAttribute(
      "data-company-ping",
      "received",
    );
  } finally {
    await app.close();
  }
});

// @termco-certifies copy-replace company-example-command source=src/renderer.ts runtime=E2E_Company_Ping
// @termco-certifies copy-replace company-example-http source=src/main.ts runtime=298_company_http_ping
// @termco-certifies copy-replace company-example-statusbar source=src/renderer.tsx runtime=E2E_Company_Statusbar
test("unlocked company-profile plugins remain whole-folder live replaceable", async () => {
  const workspace = seedWorkspace();
  const profileId = "termco.user.company-copy-e2e";
  const profileDirectory = join(
    workspace.userData,
    "plugin-platform",
    "profiles",
    profileId,
  );
  mkdirSync(profileDirectory, { recursive: true });
  const companyProfile = JSON.parse(
    readFileSync("profiles/company-example/profile.json", "utf8"),
  ) as Record<string, unknown>;
  writeFileSync(
    join(profileDirectory, "profile.json"),
    JSON.stringify({
      ...companyProfile,
      id: profileId,
    }),
  );

  const app = await electron.launch({
    args: [MAIN, workspace.dir],
    env: {
      ...process.env,
      TERMCO_PROFILE: profileId,
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
    await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 30_000 });

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
      "company-example-command",
      "e2e.company-example-command",
      "src/renderer.ts",
      (source) =>
        source.replace("Example Company: Ping", "E2E Company: Ping"),
    );
    await openCommandPalette(page);
    await page.keyboard.type("E2E Company Ping");
    await expect(
      page.getByRole("option", { name: /E2E Company: Ping/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expectWholeFolderReplacementSelected(
      page,
      "company-example-command",
      "e2e.company-example-command",
    );
    await revertWholeFolderReplacement(
      page,
      "company-example-command",
      "e2e.company-example-command",
    );

    await replaceSource(
      "company-example-statusbar",
      "e2e.company-example-statusbar",
      "src/renderer.tsx",
      (source) => source.replace("Example Company</span>", "E2E Company Statusbar</span>"),
    );
    await expect(page.getByTestId("company-example-statusbar")).toContainText(
      "E2E Company Statusbar",
    );
    await expectWholeFolderReplacementSelected(
      page,
      "company-example-statusbar",
      "e2e.company-example-statusbar",
    );
    await revertWholeFolderReplacement(
      page,
      "company-example-statusbar",
      "e2e.company-example-statusbar",
    );
    await expect(page.getByTestId("company-example-statusbar")).toContainText(
      "Example Company",
    );
    await expect(page.getByTestId("company-example-statusbar")).not.toContainText(
      "E2E Company Statusbar",
    );

    await replaceSource(
      "company-example-http",
      "e2e.company-example-http",
      "src/main.ts",
      (source) =>
        source.replace(
          "async ping(url) {",
          'async ping(url) {\n        if (url.includes("e2e-company-http")) return 298;',
        ),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__termco.capabilityCall({
            consumerPluginId: "updater-native",
            capability: "network.http",
            method: "ping",
            args: ["https://e2e-company-http.invalid/"],
          }),
        ),
      )
      .toBe(298);
    await expectWholeFolderReplacementSelected(
      page,
      "company-example-http",
      "e2e.company-example-http",
    );
    await revertWholeFolderReplacement(
      page,
      "company-example-http",
      "e2e.company-example-http",
    );
  } finally {
    await app.close();
  }
});

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, openSettingsWindow, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// PTY replacement may destroy disposable E2E terminal processes. Production
// still requires the explicit warning and user acceptance.
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

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP probe server did not expose a TCP port");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

// @termco-certifies copy-replace http-native source=src/main.ts runtime=299_http_ping
test("HTTP provider replacement reaches the unchanged updater consumer", async ({
  page,
  workspace,
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });
  const port = await listen(server);
  try {
    await replaceSource(
      page,
      workspace.userData,
      "http-native",
      "e2e.http-native",
      "src/main.ts",
      (source) =>
        source.replace(
          "async ping(url) {",
          "async ping(url) {\n        if (url.includes(\"e2e-http-probe\")) return 299;",
        ),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__termco.capabilityCall({
            consumerPluginId: "updater-native",
            capability: "network.http",
            method: "ping",
            args: ["https://e2e-http-probe.invalid/"],
          }),
        ),
      )
      .toBe(299);
    await expectWholeFolderReplacementSelected(
      page,
      "http-native",
      "e2e.http-native",
    );
    await revertWholeFolderReplacement(page, "http-native", "e2e.http-native");
    await expect
      .poll(() =>
        page.evaluate((url) =>
          window.__termco.capabilityCall({
            consumerPluginId: "updater-native",
            capability: "network.http",
            method: "ping",
            args: [url],
          }), `http://127.0.0.1:${port}/`),
      )
      .toBe(204);
  } finally {
    await close(server);
  }
});

// @termco-certifies copy-replace storage-json source=src/storage.ts runtime=E2E_storage_probe
test("storage provider replacement reaches the unchanged preferences consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "storage-json",
    "e2e.storage-json",
    "src/storage.ts",
    (source) =>
      source.replace(
        "const data = new Map<string, unknown>(Object.entries(defaults));",
        'const data = new Map<string, unknown>(Object.entries(defaults));\n        data.set("e2eStorageProbe", "E2E storage provider");',
      ),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "general-settings",
          capability: "settings.preferences",
          method: "get",
          args: ["e2eStorageProbe"],
        }),
      ),
    )
    .toBe("E2E storage provider");
  await expectWholeFolderReplacementSelected(
    page,
    "storage-json",
    "e2e.storage-json",
  );
  await revertWholeFolderReplacement(page, "storage-json", "e2e.storage-json");
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "general-settings",
      capability: "settings.preferences",
      method: "get",
      args: ["e2eStorageProbe"],
    }),
  );
  expect(restored).toBeUndefined();
});

// @termco-certifies copy-replace secrets-native source=src/backend.ts runtime=E2E_secret_probe
test("secrets provider replacement reaches the unchanged Models consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "secrets-native",
    "e2e.secrets-native",
    "src/backend.ts",
    (source) =>
      source.replace(
        "useFileStore\n      ? (readStore()[keyFor(service, account)] ?? null)",
        'service === "termco-e2e" && account === "probe"\n      ? "E2E secret provider"\n      : useFileStore\n        ? (readStore()[keyFor(service, account)] ?? null)',
      ),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "models-settings",
          capability: "secrets.application",
          method: "get",
          args: ["termco-e2e", "probe"],
        }),
      ),
    )
    .toBe("E2E secret provider");
  await expectWholeFolderReplacementSelected(
    page,
    "secrets-native",
    "e2e.secrets-native",
  );
  await revertWholeFolderReplacement(page, "secrets-native", "e2e.secrets-native");
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "models-settings",
      capability: "secrets.application",
      method: "get",
      args: ["termco-e2e", "probe"],
    }),
  );
  expect(restored).toBeNull();
});

// @termco-certifies copy-replace pty-native source=src/main.ts runtime=e2e_shell_name
test("PTY provider replacement reaches the unchanged Terminal settings consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "pty-native",
    "e2e.pty-native",
    "src/main.ts",
    (source) =>
      source.replace("shellName: detectShellName,", 'shellName: () => "e2e-shell-provider",'),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "terminal-settings",
          capability: "terminal.pty",
          method: "shellName",
          args: [],
        }),
      ),
    )
    .toBe("e2e-shell-provider");
  await expectWholeFolderReplacementSelected(page, "pty-native", "e2e.pty-native");
  await revertWholeFolderReplacement(page, "pty-native", "e2e.pty-native");
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "terminal-settings",
      capability: "terminal.pty",
      method: "shellName",
      args: [],
    }),
  );
  expect(restored).not.toBe("e2e-shell-provider");
  expect(typeof restored).toBe("string");
});

// @termco-certifies copy-replace workspace-native source=src/workspace.ts runtime=e2e_workspace_normalization
test("workspace provider replacement reaches the unchanged Terminal settings consumer", async ({
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "workspace-native",
    "e2e.workspace-native",
    "src/workspace.ts",
    (source) =>
      source.replace(
        "const normalize = (workspace: WorkspaceEnv) => {",
        'const normalize = (workspace: WorkspaceEnv) => {\n    if (workspace?.kind === "ssh" && workspace.connectionId === "e2e-probe") {\n      return { kind: "ssh" as const, connectionId: "e2e-workspace-provider" };\n    }',
      ),
  );
  const input = {
    kind: "ssh",
    connectionId: "e2e-probe",
    host: "example.invalid",
  };
  await expect
    .poll(() =>
      page.evaluate((workspaceInput) =>
        window.__termco.capabilityCall({
          consumerPluginId: "terminal-settings",
          capability: "workspace.registry",
          method: "normalize",
          args: [workspaceInput],
        }), input,
      ),
    )
    .toEqual({ kind: "ssh", connectionId: "e2e-workspace-provider" });
  await expectWholeFolderReplacementSelected(
    page,
    "workspace-native",
    "e2e.workspace-native",
  );
  await revertWholeFolderReplacement(page, "workspace-native", "e2e.workspace-native");
  const restored = await page.evaluate((workspaceInput) =>
    window.__termco.capabilityCall({
      consumerPluginId: "terminal-settings",
      capability: "workspace.registry",
      method: "normalize",
      args: [workspaceInput],
    }), input,
  );
  expect(restored).toEqual({ kind: "ssh", connectionId: "e2e-probe" });
});

// @termco-certifies copy-replace updater-native source=src/main.ts runtime=Install_v99.0.0
test("updater replacement reaches the unchanged About settings consumer", async ({
  app,
  page,
  workspace,
}) => {
  await replaceSource(
    page,
    workspace.userData,
    "updater-native",
    "e2e.updater-native",
    "src/main.ts",
    (source) =>
      source.replace(
        "async check() {\n        try {",
        'async check() {\n        return { available: true, version: "99.0.0", currentVersion: app.getVersion(), body: "E2E updater provider" };\n        try {',
      ),
  );
  const settings = await openSettingsWindow(app, page);
  await settings.getByRole("button", { name: "About", exact: true }).first().click();
  const about = settings.getByTestId("about-section");
  await expect(about).toBeVisible({ timeout: 15_000 });
  await about.getByRole("button", { name: /Check for updates/ }).click();
  const updateDialog = settings.getByRole("dialog", {
    name: "Termco v99.0.0 is available",
  });
  await expect(updateDialog).toContainText("E2E updater provider", {
    timeout: 15_000,
  });
  await expectWholeFolderReplacementSelected(
    settings,
    "updater-native",
    "e2e.updater-native",
  );
  await updateDialog.getByRole("button", { name: "Later" }).click();
  await revertWholeFolderReplacement(settings, "updater-native", "e2e.updater-native");
  await settings.getByRole("button", { name: "About", exact: true }).first().click();
  await expect(
    settings
      .getByTestId("about-section")
      .getByRole("button", { name: /Check for updates|You're up to date/ }),
  )
    .toBeVisible({ timeout: 15_000 });
});

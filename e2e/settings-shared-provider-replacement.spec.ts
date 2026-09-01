import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// LSP replacement intentionally warns before destroying live server sessions.
// Every app launched by this spec uses throwaway user data and no seeded LSP
// sessions, so acknowledge that native warning without weakening production.
process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

// @termco-certifies copy-replace application-identity-native source=src/main.ts runtime=E2E_Termco_application_info
test("application identity replacement reaches the unchanged About consumer", async ({
  page,
  workspace,
}) => {
  const before = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "about-native",
      capability: "application.info",
      method: "getInfo",
      args: [],
    }),
  );
  expect(before).toMatchObject({ name: "Termco" });

  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "application-identity-native",
      replacementId: "e2e.application-identity-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.application-identity-native",
    "src",
    "main.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "name: applicationName(app.isPackaged, app.getName()),",
    'name: "E2E Termco",',
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.application-identity-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "about-native",
          capability: "application.info",
          method: "getInfo",
          args: [],
        }),
      ),
    )
    .toMatchObject({ name: "E2E Termco" });
  await expectWholeFolderReplacementSelected(
    page,
    "application-identity-native",
    "e2e.application-identity-native",
  );

  await revertWholeFolderReplacement(
    page,
    "application-identity-native",
    "e2e.application-identity-native",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "about-native",
          capability: "application.info",
          method: "getInfo",
          args: [],
        }),
      ),
    )
    .toMatchObject({ name: "Termco" });
});

// @termco-certifies copy-replace preferences-json source=src/preferences.ts runtime=E2E_preference_provider
test("preferences provider replacement reaches an unchanged settings consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "preferences-json",
      replacementId: "e2e.preferences-json",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.preferences-json",
    "src",
    "preferences.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "return values.get(checkedKey(key)) as T | undefined;",
    [
      "const checked = checkedKey(key);",
      '      if (checked === "e2eProbe") return "E2E preference provider" as T;',
      "      return values.get(checked) as T | undefined;",
    ].join("\n      "),
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.preferences-json"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "general-settings",
          capability: "settings.preferences",
          method: "get",
          args: ["e2eProbe"],
        }),
      ),
    )
    .toBe("E2E preference provider");
  await expectWholeFolderReplacementSelected(
    page,
    "preferences-json",
    "e2e.preferences-json",
  );

  await revertWholeFolderReplacement(
    page,
    "preferences-json",
    "e2e.preferences-json",
  );
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "general-settings",
      capability: "settings.preferences",
      method: "get",
      args: ["e2eProbe"],
    }),
  );
  expect(restored).toBeUndefined();
});

// @termco-certifies copy-replace lsp-native source=src/main.ts runtime=e2e-session
test("LSP provider replacement reaches the unchanged Languages consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "lsp-native",
      replacementId: "e2e.lsp-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.lsp-native",
    "src",
    "main.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "return lspManager().statusList();",
    [
      "return [",
      "          ...lspManager().statusList(),",
      "          {",
      '            sessionKey: "e2e-session",',
      '            serverId: "e2e-server",',
      '            scopeKey: "e2e",',
      '            root: "/e2e",',
      '            state: "running" as const,',
      "            openDocs: 0,",
      "          },",
      "        ];",
    ].join("\n        "),
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.lsp-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(async () => {
      const sessions = await page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "languages-settings",
          capability: "lsp.sessions",
          method: "sessionStatus",
          args: [],
        }),
      );
      return (sessions as Array<{ sessionKey: string }>).map(
        (session) => session.sessionKey,
      );
    })
    .toContain("e2e-session");
  await expectWholeFolderReplacementSelected(
    page,
    "lsp-native",
    "e2e.lsp-native",
  );

  await revertWholeFolderReplacement(page, "lsp-native", "e2e.lsp-native");
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "languages-settings",
      capability: "lsp.sessions",
      method: "sessionStatus",
      args: [],
    }),
  );
  expect(
    (restored as Array<{ sessionKey: string }>).map(
      (session) => session.sessionKey,
    ),
  ).not.toContain("e2e-session");
});

// @termco-certifies copy-replace history-native source=src/main.ts runtime=e2e-history-command
test("history provider replacement reaches the unchanged system-tools consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "history-native",
      replacementId: "e2e.history-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.history-native",
    "src",
    "main.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    ": state.commands(prefix, limit);",
    ': ["e2e-history-command", ...(await state.commands(prefix, limit))];',
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.history-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "ai-tools-system-native",
          capability: "terminal.history",
          method: "commands",
          args: ["", 25, { kind: "local" }],
        }),
      ),
    )
    .toContain("e2e-history-command");
  await expectWholeFolderReplacementSelected(
    page,
    "history-native",
    "e2e.history-native",
  );

  await revertWholeFolderReplacement(
    page,
    "history-native",
    "e2e.history-native",
  );
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "ai-tools-system-native",
      capability: "terminal.history",
      method: "commands",
      args: ["", 25, { kind: "local" }],
    }),
  );
  expect(restored).not.toContain("e2e-history-command");
});

// @termco-certifies copy-replace git-native source=src/main.ts runtime=e2e-provider_branch
test("Git provider replacement reaches the unchanged source-control consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "git-native",
      replacementId: "e2e.git-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.git-native",
    "src",
    "main.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "return { repo, status: await gitStatus(repo.repoRoot, workspace).catch(() => null) };",
    'return { repo: { ...repo, branch: "e2e-provider" }, status: await gitStatus(repo.repoRoot, workspace).catch(() => null) };',
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.git-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(() =>
      page.evaluate((cwd) =>
        window.__termco.capabilityCall({
          consumerPluginId: "source-control-sidebar",
          capability: "git.repository",
          method: "panelSnapshot",
          args: [cwd, { kind: "local" }],
        }), workspace.dir,
      ),
    )
    .toMatchObject({ repo: { branch: "e2e-provider" } });
  await expectWholeFolderReplacementSelected(
    page,
    "git-native",
    "e2e.git-native",
  );

  await revertWholeFolderReplacement(page, "git-native", "e2e.git-native");
  await expect
    .poll(() =>
      page.evaluate((cwd) =>
        window.__termco.capabilityCall({
          consumerPluginId: "source-control-sidebar",
          capability: "git.repository",
          method: "panelSnapshot",
          args: [cwd, { kind: "local" }],
        }), workspace.dir,
      ),
    )
    .toMatchObject({ repo: { branch: "main" } });
});

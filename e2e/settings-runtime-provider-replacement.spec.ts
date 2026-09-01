import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  expectWholeFolderReplacementSelected,
  revertWholeFolderReplacement,
} from "./helpers";

// Shell and browser providers own destructive live resources. These isolated
// app instances use throwaway user data; acknowledge the native warning while
// leaving the production confirmation path mandatory.
process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT = "1";

interface LivePtySession {
  id: string;
  label: string;
}

interface CapturedReplacementDialog {
  title?: string;
  message?: string;
  detail?: string;
  buttons?: string[];
}

interface TestPtySession {
  id: number;
  dataChannel: number;
  exitChannel: number;
}

const PTY_RESOURCE_LABEL = "local and interactive SSH terminal sessions";
const ROLLBACK_RESOURCE_NOTICE =
  "If the new plugin fails, the previous provider will be restored, " +
  "but destroyed live sessions cannot be restored.";
const DELIBERATE_FAILURE = "E2E deliberate PTY candidate failure";
const EXPECTED_FAILURE =
  "live plugin replacement failed during candidate-activation: " +
  `${DELIBERATE_FAILURE}. ` +
  "Previous provider was restored. Live resources were destroyed and cannot be restored.";

async function ptyCall<T>(
  page: Page,
  method: string,
  args: unknown[] = [],
): Promise<T> {
  return page.evaluate(
    ({ method, args }) =>
      window.__termco.capabilityCall({
        consumerPluginId: "terminal-surface-native",
        capability: "terminal.pty",
        method,
        args,
      }),
    { method, args },
  ) as Promise<T>;
}

async function openTestPty(page: Page, cwd: string): Promise<TestPtySession> {
  return page.evaluate(async (cwd) => {
    const dataChannel = window.__termco.registerChannel(() => {});
    const exitChannel = window.__termco.registerChannel(() => {});
    try {
      const id = (await window.__termco.capabilityCall({
        consumerPluginId: "terminal-surface-native",
        capability: "terminal.pty",
        method: "open",
        args: [
          { cols: 80, rows: 24, cwd, blocks: false, workspace: { kind: "local" } },
          {
            onData: { __termcoChannel: dataChannel },
            onExit: { __termcoChannel: exitChannel },
          },
        ],
      })) as number;
      return { id, dataChannel, exitChannel };
    } catch (error) {
      window.__termco.releaseChannel(dataChannel);
      window.__termco.releaseChannel(exitChannel);
      throw error;
    }
  }, cwd);
}

async function releaseTestPtyChannels(
  page: Page,
  session: TestPtySession,
): Promise<void> {
  await page.evaluate(({ dataChannel, exitChannel }) => {
    window.__termco.releaseChannel(dataChannel);
    window.__termco.releaseChannel(exitChannel);
  }, session);
}

async function installReplacementDialogHarness(
  app: ElectronApplication,
): Promise<void> {
  await app.evaluate(({ dialog }) => {
    delete process.env.TERMCO_E2E_AUTO_CONFIRM_REPLACEMENT;
    const state = {
      responses: [0, 1, 1],
      records: [] as CapturedReplacementDialog[],
    };
    (globalThis as typeof globalThis & { __termcoReplacementDialogs?: typeof state })
      .__termcoReplacementDialogs = state;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as CapturedReplacementDialog;
      state.records.push({
        title: options.title,
        message: options.message,
        detail: options.detail,
        buttons: options.buttons ? [...options.buttons] : undefined,
      });
      return {
        response: state.responses.shift() ?? 0,
        checkboxChecked: false,
      };
    }) as typeof dialog.showMessageBox;
  });
}

async function capturedReplacementDialogs(
  app: ElectronApplication,
): Promise<CapturedReplacementDialog[]> {
  return app.evaluate(() => {
    const state = (
      globalThis as typeof globalThis & {
        __termcoReplacementDialogs?: { records: CapturedReplacementDialog[] };
      }
    ).__termcoReplacementDialogs;
    return state?.records ?? [];
  });
}

function replacementDialogDetail(resources: LivePtySession[]): string {
  const count = resources.length;
  return [
    `This live graph replacement will destroy ${count} live resource${
      count === 1 ? "" : "s"
    }. They cannot be restored.`,
    `\nResources that will be destroyed:\n${resources
      .map(
        (resource) =>
          `${PTY_RESOURCE_LABEL}: ${resource.label} (${resource.id})`,
      )
      .join("\n")}`,
    `\n${ROLLBACK_RESOURCE_NOTICE}`,
  ].join("");
}

test(
  "PTY replacement confirms exact resources and restores after candidate failure",
  async ({ app, page, workspace }) => {
    // Keep a non-terminal tab alive while clearing the shell-owned PTY. When
    // the sole terminal leaf exits, the product intentionally closes the app.
    await page
      .getByRole("button", { name: "README.md", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("tab", { name: /README\.md/ }).first(),
    ).toBeVisible();
    await ptyCall<number>(page, "closeAll");
    const originalSession = await openTestPty(page, workspace.dir);
    const originalResources = await ptyCall<LivePtySession[]>(page, "liveSessions");
    expect(originalResources).toEqual([
      {
        id: String(originalSession.id),
        label: expect.stringMatching(
          new RegExp(`^terminal ${originalSession.id} \\(pid \\d+\\)$`),
        ),
      },
    ]);

    await installReplacementDialogHarness(app);

    const declinedId = "e2e.pty-native-declined";
    const declined = await page.evaluate((replacementId) =>
      window.__termcoE2E.copyAndReplacePluginThroughPlan({
        pluginId: "pty-native",
        replacementId,
      }), declinedId,
    );
    expect(declined.status).toBe("cancelled");

    const expectedOriginalDetail = replacementDialogDetail(originalResources);
    await expect
      .poll(() => capturedReplacementDialogs(app))
      .toEqual([
        {
          title: "Replace plugin while Termco is running?",
          message: "This replacement will stop live resources",
          detail: expectedOriginalDetail,
          buttons: ["Cancel", "Stop resources and replace"],
        },
      ]);
    const afterDecline = await page.evaluate(async () =>
      (await window.__termco.rendererPluginProfile()).catalog.map(
        (plugin) => plugin.id,
      ),
    );
    expect(afterDecline).toContain("pty-native");
    expect(afterDecline).not.toContain(declinedId);
    expect(await ptyCall<LivePtySession[]>(page, "liveSessions")).toEqual(
      originalResources,
    );

    const replacementId = "e2e.pty-native-failing";
    const replaced = await page.evaluate((replacementId) =>
      window.__termcoE2E.copyAndReplacePluginThroughPlan({
        pluginId: "pty-native",
        replacementId,
      }), replacementId,
    );
    expect(replaced.status).toBe("replaced");
    await expectWholeFolderReplacementSelected(
      page,
      "pty-native",
      replacementId,
    );
    await releaseTestPtyChannels(page, originalSession);

    await ptyCall<number>(page, "closeAll");
    const candidateSession = await openTestPty(page, workspace.dir);
    const candidateResources = await ptyCall<LivePtySession[]>(page, "liveSessions");
    expect(candidateResources).toHaveLength(1);

    const source = join(
      workspace.userData,
      "plugin-platform",
      "plugins",
      replacementId,
      "src",
      "main.ts",
    );
    const originalSource = readFileSync(source, "utf8");
    const failingSource = originalSource.replace(
      "  async activate(context) {",
      [
        "  async activate(context) {",
        `    throw new Error("${DELIBERATE_FAILURE}");`,
      ].join("\n"),
    );
    expect(failingSource).not.toBe(originalSource);
    writeFileSync(source, failingSource);

    const reloadError = await page.evaluate(async (pluginId) => {
      try {
        await window.__termco.applyPlugin(pluginId);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, replacementId);
    expect(reloadError).toContain(EXPECTED_FAILURE);

    const dialogs = await capturedReplacementDialogs(app);
    expect(dialogs).toHaveLength(3);
    expect(dialogs[1]).toMatchObject({ detail: expectedOriginalDetail });
    expect(dialogs[2]).toMatchObject({
      detail: replacementDialogDetail(candidateResources),
    });
    await expectWholeFolderReplacementSelected(
      page,
      "pty-native",
      replacementId,
    );
    expect(await ptyCall<string>(page, "shellName")).toEqual(
      expect.any(String),
    );

    await releaseTestPtyChannels(page, candidateSession);
    await ptyCall<number>(page, "closeAll");
  },
);

// @termco-certifies copy-replace shell-native source=src/main.ts runtime=e2e-shell-provider
test("shell provider replacement reaches the unchanged terminal-tools consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "shell-native",
      replacementId: "e2e.shell-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.shell-native",
    "src",
    "main.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    ": runCommand(command, cwd, timeoutSeconds, environment);",
    [
      ": Promise.resolve({",
      '              stdout: "e2e-shell-provider",',
      '              stderr: "",',
      "              exit_code: 0,",
      "              timed_out: false,",
      "              truncated: false,",
      "            });",
    ].join("\n            "),
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.shell-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(() =>
      page.evaluate((cwd) =>
        window.__termco.capabilityCall({
          consumerPluginId: "ai-tools-terminal-native",
          capability: "shell.execution",
          method: "run",
          args: ["printf ignored", cwd, 5, { kind: "local" }],
        }), workspace.dir,
      ),
    )
    .toMatchObject({ stdout: "e2e-shell-provider", exit_code: 0 });
  await expectWholeFolderReplacementSelected(
    page,
    "shell-native",
    "e2e.shell-native",
  );

  await revertWholeFolderReplacement(page, "shell-native", "e2e.shell-native");
  await expect
    .poll(() =>
      page.evaluate((cwd) =>
        window.__termco.capabilityCall({
          consumerPluginId: "ai-tools-terminal-native",
          capability: "shell.execution",
          method: "run",
          args: ["printf shell-original", cwd, 5, { kind: "local" }],
        }), workspace.dir,
      ),
    )
    .toMatchObject({ stdout: "shell-original", exit_code: 0 });
});

// @termco-certifies copy-replace session-native source=src/main.ts runtime=e2e-session-provider
test("session provider replacement reaches the unchanged trajectory consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "session-native",
      replacementId: "e2e.session-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.session-native",
    "src",
    "main.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    '    context.provide(SESSION_HISTORY_SERVICE, history);',
    [
      "    const originalList = history.list.bind(history);",
      "    history.list = async (request) => {",
      "      const page = await originalList(request);",
      "      return { ...page, sessions: [{ sessionId: 'e2e-session-provider' as never, createdAt: 0, updatedAt: 0, backend: 'e2e', fidelity: 'adapter' as const, revision: 0 as never, health: 'healthy' as const }, ...page.sessions] };",
      "    };",
      "    context.provide(SESSION_HISTORY_SERVICE, history);",
    ].join("\n"),
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.session-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(async () => {
      const sessions = await page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "trajectory-native",
          capability: "session.history",
          method: "list",
          args: [{}],
        }),
      );
      return (sessions as { sessions: Array<{ sessionId: string }> }).sessions.map((session) => session.sessionId);
    })
    .toContain("e2e-session-provider");
  await expectWholeFolderReplacementSelected(
    page,
    "session-native",
    "e2e.session-native",
  );

  await revertWholeFolderReplacement(page, "session-native", "e2e.session-native");
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "trajectory-native",
      capability: "session.history",
      method: "list",
      args: [{}],
    }),
  );
  expect((restored as { sessions: Array<{ sessionId: string }> }).sessions.map((session) => session.sessionId)).not
    .toContain("e2e-session-provider");
});

// @termco-certifies copy-replace browser-native source=src/main.ts runtime=e2e-browser-command
test("browser provider replacement reaches the unchanged browser-tools consumer", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(() =>
    window.__termcoE2E.copyAndReplacePluginThroughPlan({
      pluginId: "browser-native",
      replacementId: "e2e.browser-native",
    }),
  );
  expect(result.status).toBe("replaced");

  const source = join(
    workspace.userData,
    "plugin-platform",
    "plugins",
    "e2e.browser-native",
    "src",
    "main.ts",
  );
  expect(existsSync(source)).toBe(true);
  const original = readFileSync(source, "utf8");
  const edited = original.replace(
    "const commands = [...BASE_COMMANDS, ...aiCommands];",
    'const commands = ["e2e-browser-command", ...BASE_COMMANDS, ...aiCommands];',
  );
  expect(edited).not.toBe(original);
  writeFileSync(source, edited);

  const apply = await page.evaluate(() =>
    window.__termco.applyPlugin("e2e.browser-native"),
  );
  expect(apply.status).toBe("replaced");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__termco.capabilityCall({
          consumerPluginId: "ai-tools-browser-native",
          capability: "browser.automation",
          method: "commands",
          args: [],
        }),
      ),
    )
    .toContain("e2e-browser-command");
  await expectWholeFolderReplacementSelected(
    page,
    "browser-native",
    "e2e.browser-native",
  );

  await revertWholeFolderReplacement(
    page,
    "browser-native",
    "e2e.browser-native",
  );
  const restored = await page.evaluate(() =>
    window.__termco.capabilityCall({
      consumerPluginId: "ai-tools-browser-native",
      capability: "browser.automation",
      method: "commands",
      args: [],
    }),
  );
  expect(restored).not.toContain("e2e-browser-command");
});

/**
 * LSP integration: diagnostics underlines from a deterministic fake language
 * server, hover tooltips, and cmd-click go-to-definition. The fake server
 * (plugins/lsp-native/src/__fixtures__/fake-lsp.mjs) is registered as a custom
 * server in the seeded userData config and handles the `.fk` extension.
 */
import { expect, test as base, MOD, seedWorkspace, type Workspace } from "./fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openFile } from "./helpers";

const FAKE_LSP = fileURLToPath(
  new URL("../plugin-repository/plugins/lsp-native/src/__fixtures__/fake-lsp.mjs", import.meta.url),
);

const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({}, use) => {
    const ws = seedWorkspace();
    writeFileSync(
      join(ws.dir, "demo.fk"),
      "hello world\nTODO fix me\ntarget line here\n",
    );
    // Routing fixtures: ngapp/ has the marker, the root-level html does not.
    mkdirSync(join(ws.dir, "ngapp"), { recursive: true });
    writeFileSync(join(ws.dir, "ngapp", "angular.json"), "{}");
    writeFileSync(join(ws.dir, "ngapp", "template.html"), "widget markup\n");
    writeFileSync(join(ws.dir, "plain.html"), "plain markup\n");
    writeFileSync(
      join(ws.userData, "termco-lsp.json"),
      JSON.stringify({
        // Disable curated servers that would otherwise claim these files and
        // npm-install real binaries mid-test.
        overrides: {
          angular: { enabled: false },
          html: { enabled: false },
          tailwind: { enabled: false },
          eslint: { enabled: false },
        },
        custom: [
          {
            id: "fake",
            name: "Fake LSP",
            languages: ["fk"],
            command: process.execPath,
            args: [FAKE_LSP],
            rootMarkers: [".git"],
            enabled: true,
            custom: true,
          },
          {
            id: "fake-lint",
            name: "Fake Linter",
            role: "secondary",
            languages: ["fk"],
            command: process.execPath,
            args: [FAKE_LSP, "--tag=linty"],
            rootMarkers: [".git"],
            enabled: true,
            custom: true,
          },
          {
            id: "fake-ng",
            name: "Fake Angular",
            languages: ["html"],
            projectMarkers: ["angular.json"],
            command: process.execPath,
            args: [FAKE_LSP, "--tag=ngfake"],
            rootMarkers: ["angular.json"],
            enabled: true,
            custom: true,
          },
          {
            id: "fake-html",
            name: "Fake generic HTML",
            languages: ["html"],
            command: process.execPath,
            args: [FAKE_LSP, "--tag=generic-html"],
            rootMarkers: [".git"],
            enabled: true,
            custom: true,
          },
        ],
      }),
    );
    await use(ws);
  },
});

test("source-owned capability opens the configured language server", async ({
  page,
  workspace,
}) => {
  const result = await page.evaluate(async ({ path, root }) => {
    const call = (method: string, args: unknown[]) =>
      window.__termco.capabilityCall({
        consumerPluginId: "editor-surface-native",
        capability: "lsp.sessions",
        method,
        args,
        caller: true,
      });
    const servers = await call("listServers", []) as Array<{
      config: { id: string };
    }>;
    const opened = await call("invoke", ["lsp_doc_open", {
      workspace: { kind: "local" },
      rigRoot: root,
      path,
      languageId: "fk",
      text: "hello world\nTODO fix me\n",
    }]) as { active: boolean; reason?: string };
    if (opened.active) {
      await call("invoke", ["lsp_doc_close", {
        workspace: { kind: "local" },
        path,
      }]);
    }
    const status = await call("sessionStatus", []);
    return { serverIds: servers.map((server) => server.config.id), opened, status };
  }, { path: join(workspace.dir, "probe.fk"), root: workspace.dir });

  expect(result.serverIds).toContain("fake");
  expect(result.opened.active, JSON.stringify(result)).toBe(true);
});

test("activates a session and shows diagnostics for TODO lines", async ({
  page,
}) => {
  await openFile(page, "demo.fk");
  // Session active → the editor gets the cm-lsp-enabled class.
  await expect(page.locator(".cm-editor.cm-lsp-enabled").first()).toBeVisible({
    timeout: 20_000,
  });
  // The fake server flags every TODO with a warning diagnostic.
  await expect(page.locator(".cm-lintRange-warning").first()).toBeVisible({
    timeout: 20_000,
  });
  // Semantic tokens: the fake marks the first word per line as a function.
  await expect(page.locator(".cm-lsp-tok-function").first()).toBeVisible({
    timeout: 20_000,
  });
});

test("diagnostics update after edits (debounced didChange)", async ({
  page,
}) => {
  await openFile(page, "demo.fk");
  await expect(page.locator(".cm-lintRange-warning").first()).toBeVisible({
    timeout: 20_000,
  });
  // Rewrite "TODO" → "DONE": the warning must disappear. Double-click selects
  // the word, typing replaces it — robust against cursor-placement flakiness.
  await page
    .locator(".cm-line", { hasText: "TODO fix me" })
    .dblclick({ position: { x: 12, y: 8 } });
  await page.keyboard.type("DONE");
  await expect(page.locator(".cm-lintRange-warning")).toHaveCount(0, {
    timeout: 20_000,
  });
});

test("hover shows LSP docs as a markdown tooltip", async ({ page }) => {
  await openFile(page, "demo.fk");
  await expect(page.locator(".cm-editor.cm-lsp-enabled").first()).toBeVisible({
    timeout: 20_000,
  });
  const firstLine = page.locator(".cm-line", { hasText: "hello world" });
  await firstLine.hover({ position: { x: 12, y: 8 } });
  const tooltip = page.locator(".cm-lsp-md");
  await expect(tooltip).toBeVisible({ timeout: 20_000 });
  await expect(tooltip).toContainText("docs for");
});

test("marker-matched server takes .html in the angular-style project", async ({
  page,
}) => {
  await page.getByRole("button", { name: "ngapp", exact: true }).first().click();
  await openFile(page, "template.html");
  await expect(page.locator(".cm-editor.cm-lsp-enabled").first()).toBeVisible({
    timeout: 20_000,
  });
  await page
    .locator(".cm-line", { hasText: "widget markup" })
    .hover({ position: { x: 12, y: 8 } });
  const tooltip = page.locator(".cm-lsp-md");
  await expect(tooltip).toBeVisible({ timeout: 20_000 });
  await expect(tooltip).toContainText("ngfake docs for");
});

test("generic server keeps .html outside marker projects", async ({ page }) => {
  await openFile(page, "plain.html");
  await expect(page.locator(".cm-editor.cm-lsp-enabled").first()).toBeVisible({
    timeout: 20_000,
  });
  await page
    .locator(".cm-line", { hasText: "plain markup" })
    .hover({ position: { x: 12, y: 8 } });
  const tooltip = page.locator(".cm-lsp-md");
  await expect(tooltip).toBeVisible({ timeout: 20_000 });
  await expect(tooltip).toContainText("generic-html docs for");
});

test("secondary server's diagnostics merge with the primary's", async ({
  page,
}) => {
  await openFile(page, "demo.fk");
  await expect(page.locator(".cm-lintRange-warning").first()).toBeVisible({
    timeout: 20_000,
  });
  // Give the secondary session a moment to attach and publish, then hover the
  // squiggle: the lint tooltip lists BOTH sources' messages.
  await page.waitForTimeout(1_500);
  const providerState = await page.evaluate(async () => {
    const call = (method: string, args: unknown[]) =>
      window.__termco.capabilityCall({
        consumerPluginId: "editor-surface-native",
        capability: "lsp.sessions",
        method,
        args,
        caller: true,
      });
    return {
      sessions: await call("sessionStatus", []),
      diagnostics: await call("invoke", ["lsp_diagnostics", {
        workspace: { kind: "local" },
      }]),
    };
  });
  expect(providerState, JSON.stringify(providerState)).toMatchObject({
    sessions: [
      expect.objectContaining({ serverId: "fake", state: "running" }),
      expect.objectContaining({ serverId: "fake-lint", state: "running" }),
    ],
    diagnostics: {
      files: [expect.objectContaining({ diagnostics: expect.any(Array) })],
    },
  });
  const mergedDiagnostics = (providerState.diagnostics as {
    files: Array<{ diagnostics: unknown[] }>;
  }).files[0]?.diagnostics ?? [];
  expect(mergedDiagnostics, JSON.stringify(providerState)).toHaveLength(2);
  await page
    .locator(".cm-lintRange-warning")
    .first()
    .hover({ position: { x: 4, y: 4 } });
  const lintTooltip = page.locator(".cm-tooltip-lint");
  await expect(lintTooltip).toBeVisible({ timeout: 20_000 });
  await expect(lintTooltip).toContainText("found a TODO (fake-lsp)");
  await expect(lintTooltip).toContainText("found a TODO (linty)");
});

test("cmd-click jumps to the definition (line 1)", async ({ page }) => {
  await openFile(page, "demo.fk");
  await expect(page.locator(".cm-editor.cm-lsp-enabled").first()).toBeVisible({
    timeout: 20_000,
  });
  // Put the cursor somewhere on line 3 first.
  const targetLine = page.locator(".cm-line", { hasText: "target line here" });
  await targetLine.click();
  // Cmd/Ctrl-click a word on line 3 → fake server's definition = line 0.
  await targetLine.click({
    modifiers: [MOD as "Meta" | "Control"],
    position: { x: 12, y: 8 },
  });
  await expect(
    page.locator(".cm-activeLine", { hasText: "hello world" }),
  ).toBeVisible({ timeout: 20_000 });
});

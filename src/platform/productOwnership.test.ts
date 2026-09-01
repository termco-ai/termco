// @vitest-environment node
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const featurePluginsRoot = join(root, "plugin-repository", "plugins");
const corePluginsRoot = join(root, "core-plugins");
const corePluginIds = new Set([
  "boot-diagnostics-native",
  "plugin-manager-native",
  "safe-recovery-native",
  "settings-native",
  "ui-shell-native",
  "updater-native",
  "workspace-shell-native",
]);

function pluginRoot(pluginId: string): string {
  return join(
    corePluginIds.has(pluginId) ? corePluginsRoot : featurePluginsRoot,
    pluginId,
  );
}

async function expectAbsent(relativePaths: readonly string[]): Promise<void> {
  await Promise.all(
    relativePaths.map((relative) =>
      expect(fs.stat(join(root, relative))).rejects.toMatchObject({
        code: "ENOENT",
      }),
    ),
  );
}

async function pluginSource(
  pluginId: string,
  relativePath: string,
): Promise<string> {
  return fs.readFile(join(pluginRoot(pluginId), relativePath), "utf8");
}

describe("migrated product ownership", () => {
  it("forbids transitional host imports in every source-owning plugin", async () => {
    for (const pluginsRoot of [featurePluginsRoot, corePluginsRoot]) {
      const pluginDirectories = (
        await fs.readdir(pluginsRoot, { withFileTypes: true })
      ).filter((entry) => entry.isDirectory());

      for (const directory of pluginDirectories) {
        const sourcePluginRoot = join(pluginsRoot, directory.name);
        const manifest = JSON.parse(
          await fs.readFile(
            join(sourcePluginRoot, "termco-plugin.json"),
            "utf8",
          ),
        ) as Record<string, unknown>;
        expect(
          Object.hasOwn(manifest, "transitionalHostImports"),
          `${directory.name} still declares transitionalHostImports`,
        ).toBe(false);

        const sourceRoot = join(sourcePluginRoot, "src");
        const sourceFiles = (
          await fs.readdir(sourceRoot, { recursive: true })
        ).filter((path) => /\.[cm]?[jt]sx?$/.test(path));
        for (const relative of sourceFiles) {
          const source = await fs.readFile(join(sourceRoot, relative), "utf8");
          expect(
            source,
            `${directory.name}/${relative} imports private application source`,
          ).not.toMatch(
            /(?:from\s*|import\s*\()\s*["'](?:@\/|@termco\/app\/|src\/|electron\/)/,
          );
        }
      }
    }

    const compiler = await fs.readFile(
      join(root, "scripts/plugin-compiler-lib.mjs"),
      "utf8",
    );
    expect(compiler).toContain("transitionalHostImports is not supported");
    expect(compiler).not.toContain("manifest.transitionalHostImports ??");
    expect(compiler).not.toContain("@termco/app/$" + "{specifier.slice(2)}");
  }, 15_000);

  it("does not retain the empty v1 renderer plugin compiler", async () => {
    await expect(
      fs.stat(join(root, "scripts/build-plugins.mjs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not retain the empty temporary main-plugin pipeline", async () => {
    await Promise.all(
      [
        "scripts/build-plugins.mjs",
        "electron/main/core/boot.ts",
        "electron/main/core/boot.test.ts",
        "electron/main/core/mainRuntime.ts",
        "src/platform/mainPluginCompiler.test.ts",
        "electron/main/plugins",
        "resources/plugins",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const packageJson = await fs.readFile(join(root, "package.json"), "utf8");
    const dev = await fs.readFile(join(root, "scripts/dev.mjs"), "utf8");
    const electronMain = await fs.readFile(
      join(root, "electron/main/index.ts"),
      "utf8",
    );
    const lifecycle = await fs.readFile(
      join(root, "electron/main/lifecycle.ts"),
      "utf8",
    );
    expect(packageJson).not.toContain("scripts/build-plugins.mjs");
    expect(dev).not.toContain("scripts/build-plugins.mjs");
    expect(electronMain).not.toMatch(/bootMainPlugins|disposeMainPlugins/);
    expect(lifecycle).not.toContain("disposeMainPlugins");
  });

  it("does not retain the superseded v1 plugin kernel", async () => {
    await Promise.all(
      ["src/kernel", "electron/main/core/lines.ts"].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const ipc = await fs.readFile(join(root, "electron/main/ipc.ts"), "utf8");
    const agentMemory = await fs.readFile(join(root, "TERMCO.md"), "utf8");
    expect(ipc).not.toContain("src/kernel");
    expect(ipc).not.toContain("kernel's destructive classification");
    expect(agentMemory).not.toContain("Cordis-style");
    expect(agentMemory).not.toContain("Ring-1");
    expect(agentMemory).not.toContain("PLUGIN_CONTRACT_MAJOR");
    expect(agentMemory).toContain("Plugin architecture");
    expect(agentMemory).toContain("Do not add compatibility adapters");
  });

  it("ships SSH runtime assets only from the source-owning provider plugin", async () => {
    const hostResources = await fs
      .readdir(join(root, "resources"), {
        recursive: true,
        withFileTypes: true,
      })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
    expect(hostResources.filter((entry) => !entry.isDirectory())).toEqual([]);
    await expect(
      fs.stat(join(root, "electron/main/resources.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(
        join(
          root,
          "plugin-repository/plugins/ssh-native/assets/shell-integration/zshrc.zsh",
        ),
      ),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(join(root, "scripts/build-server.mjs")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const manifest = JSON.parse(
      await fs.readFile(
        join(root, "plugin-repository/plugins/ssh-native/termco-plugin.json"),
        "utf8",
      ),
    ) as { assetBuilds?: Array<{ entry: string; output: string }> };
    expect(manifest.assetBuilds).toEqual([
      {
        entry: "src/server/main.ts",
        output: "assets/server/termco-server.mjs",
        platform: "node",
        target: "node18",
      },
    ]);
  });

  it("does not retain replacement claims for plugins absent from the source catalog", async () => {
    const manifests: Array<{
      directory: string;
      id: string;
      replaces?: string;
    }> = [];
    for (const pluginsRoot of [featurePluginsRoot, corePluginsRoot]) {
      const directories = await fs.readdir(pluginsRoot);
      for (const directory of directories) {
        const manifestPath = join(pluginsRoot, directory, "termco-plugin.json");
        try {
          const manifest = JSON.parse(
            await fs.readFile(manifestPath, "utf8"),
          ) as {
            id: string;
            replaces?: string;
          };
          manifests.push({ directory, ...manifest });
        } catch {}
      }
    }
    const sourceIds = new Set(manifests.map((manifest) => manifest.id));
    for (const manifest of manifests) {
      if (!manifest.replaces) continue;
      expect(
        sourceIds.has(manifest.replaces),
        `${manifest.directory} replaces absent plugin ${manifest.replaces}`,
      ).toBe(true);
    }
  });

  it("does not boot the removed v1 renderer plugin host", async () => {
    await expect(
      fs.stat(join(root, "src/core/plugin-host")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(join(root, "src/core/builtinRegistry.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(join(root, "electron/main/core/isolatedBootstrap.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(join(root, "electron/main/core/pluginScheme.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(fs.stat(join(root, "src/core/boot.ts"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    await expect(fs.stat(join(root, "src/core/shell"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(main).not.toContain("bundledPluginsReady");

    const electronMain = await fs.readFile(
      join(root, "electron/main/index.ts"),
      "utf8",
    );
    expect(electronMain).not.toContain("resolvePluginPath");
    expect(electronMain).not.toContain("isolatedBootstrapHtml");
    expect(electronMain).not.toContain("bundledPlugins");
    expect(electronMain).not.toContain("noPlugins");

    const runtimeRegistry = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeRegistry).not.toMatch(/["']app\//);
    expect(runtimeRegistry).not.toContain("APP_MODULES");

    const shell = await fs.readFile(
      join(root, "core-plugins/ui-shell-native/src/shell.ts"),
      "utf8",
    );
    expect(shell).toContain("primitives.ErrorBoundary");
    expect(shell).toContain("owner: entry.pluginId");
  });

  it("routes terminal agent hooks only through agent-hooks-native", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/agent")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(main).not.toContain('invoke("agent_enable_hooks"');
    expect(main).not.toContain("AgentHooksCapability");

    const runtime = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/managed-agent-runtime-native/src/index.ts",
      ),
      "utf8",
    );
    expect(runtime).toContain(
      'context.get<AgentHooksCapability>("agents.terminal-hooks")',
    );
  });

  it("uses only generic profile mechanics for plugin discovery and source mutation", async () => {
    await Promise.all(
      [
        "electron/main/plugin-repository/plugins/commands",
        "electron/main/plugin-repository/plugins/plugin-dev",
        "electron/main/plugin-repository/plugins/plugin-registry",
        "electron/main/core/pluginProcessHost.ts",
        "e2e/creator-mode.spec.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    await expect(
      fs.stat(join(root, "electron/main/core/boot.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const rendererRuntime = await fs.readFile(
      join(root, "src/platform/rendererRuntime.ts"),
      "utf8",
    );
    expect(rendererRuntime).toContain(
      "listSourceFiles: (pluginId) => bridge().listPluginSourceFiles(pluginId)",
    );
    expect(rendererRuntime).toContain(
      "writeSourceFile: (pluginId, relativePath, content) =>",
    );
    expect(rendererRuntime).toContain("copyAndReplacePlugin(");
    expect(rendererRuntime).toContain(
      "apply: (pluginId) => bridge().applyPlugin(pluginId)",
    );

    const tools = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-tools-plugin-dev-native/src/tools.ts",
      ),
      "utf8",
    );
    expect(tools).toContain("profile.catalog()");
    expect(tools).toContain("profile.copyAndReplace(");
    expect(tools).toContain("profile.writeSourceFile(");
    expect(tools).toContain("profile.apply(");
  });

  it("routes terminal process and history access only through selected capabilities", async () => {
    await Promise.all(
      [
        "electron/main/plugin-repository/plugins/pty",
        "electron/main/plugin-repository/plugins/history",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(main).not.toContain('invoke("pty_close_all"');
    expect(main).toMatch(
      /platformCapability<PtyCapability>\("terminal\.pty"\)\s*\.closeAll\(\)/,
    );

    const terminalOwner = join(
      root,
      "plugin-repository/plugins/terminal-surface-native",
    );

    const ptyBridge = await fs.readFile(
      join(terminalOwner, "src/terminal/lib/pty-bridge.ts"),
      "utf8",
    );
    const history = await fs.readFile(
      join(terminalOwner, "src/terminal/block/lib/history.ts"),
      "utf8",
    );
    expect(ptyBridge).toContain("terminalRuntime().pty");
    expect(ptyBridge).not.toMatch(/invoke\s*\(/);
    expect(history).toContain("terminalRuntime().history");
    expect(history).not.toMatch(/invoke\s*\(/);
  });

  it("routes MCP control through declared mcp.server consumers", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/mcp-server")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const e2e = await fs.readFile(
      join(root, "e2e/mcp-control.spec.ts"),
      "utf8",
    );
    expect(e2e).toContain('consumerPluginId: "mcp-tool-bridge"');
    expect(e2e).toContain('capability: "mcp.server"');
    expect(e2e).toContain('method: "invoke"');
    expect(e2e).not.toContain("__termco.invoke(");

    const owner = join(root, "plugin-repository/plugins/mcp-tool-bridge");
    await Promise.all(
      [
        "src/McpApprovalOverlay.tsx",
        "src/mcpApprovalStore.ts",
        "src/mcpInteractionStore.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    await Promise.all(
      [
        "plugin-repository/plugins/ai-chat-native/src/baseline/components/McpApprovalOverlay.tsx",
        "plugin-repository/plugins/ai-chat-native/src/baseline/lib/mcpBridge/mcpApprovalStore.ts",
        "plugin-repository/plugins/ai-chat-native/src/baseline/lib/mcpBridge/mcpInteractionStore.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const renderer = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(renderer).toContain("UI_OVERLAYS_SERVICE");
    expect(renderer).toContain('id: "mcp-approval"');
    expect(renderer).toContain('id: "approval-overlay"');
    expect(renderer).toContain("requires: [UI_OVERLAYS_SERVICE]");
    expect(renderer).toMatch(
      /scope\.get<UiOverlayRegistry>\(UI_OVERLAYS_SERVICE\)\.register\(overlay,\s*\{/,
    );

    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(main).not.toContain("mcpApprovalStore");
    expect(main).not.toContain("mcpInteractionStore");
    expect(main).not.toContain("addApproval:");
    expect(main).not.toContain("addInteraction:");

    expect(main).not.toContain("./modules/ai/tools/mcpSurface");
    expect(main).not.toContain("./modules/ai/lib/mcpBridge/dispatcher");
    await expect(
      fs.stat(join(root, "src/platform/capabilities")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await Promise.all(
      [
        "src/modules/ai/tools/mcpSurface.ts",
        "src/modules/ai/tools/mcpSurface.test.ts",
        "src/modules/ai/lib/mcpBridge/dispatcher.ts",
        "src/modules/ai/lib/mcpBridge/dispatcher.test.ts",
        "src/modules/ai/lib/mcpBridge/rigToolContext.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const bridgeOwner = join(
      root,
      "plugin-repository/plugins/mcp-tool-bridge/src",
    );
    await Promise.all(
      [
        "toolSurface.ts",
        "toolSurface.test.ts",
        "toolExecutor.ts",
        "toolExecutor.test.ts",
        "rigToolRuntime.ts",
      ].map((relative) =>
        expect(fs.stat(join(bridgeOwner, relative))).resolves.toBeTruthy(),
      ),
    );
  });

  it("keeps the complete Explorer implementation only in explorer-sidebar", async () => {
    await expect(
      fs.stat(join(root, "src/modules/explorer")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const owner = join(root, "plugin-repository/plugins/explorer-sidebar");
    const requiredSource = [
      "src/renderer.tsx",
      "src/explorer/FileExplorer.tsx",
      "src/explorer/components/ExplorerHeader.tsx",
      "src/explorer/components/ExplorerSearch.tsx",
      "src/explorer/components/ExplorerContextMenu.tsx",
      "src/explorer/lib/useFileTree/useFileTree.ts",
      "src/explorer/lib/contextActions.ts",
      "src/explorer/lib/iconResolver.ts",
      "src/explorer/lib/watch.ts",
      "src/explorer/lib/iconResolver.test.ts",
      "src/explorer/lib/watch.test.ts",
    ];
    await Promise.all(
      requiredSource.map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/explorer");
  });

  it("keeps the complete theme implementation only in theme-native", async () => {
    await expect(
      fs.stat(join(root, "src/modules/theme")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const owner = join(root, "plugin-repository/plugins/theme-native");
    const requiredSource = [
      "src/renderer.tsx",
      "src/apply.ts",
      "src/background.ts",
      "src/catalog.ts",
      "src/model.ts",
      "src/model.test.ts",
      "src/renderer.test.ts",
      "src/themes/termco-default.ts",
      "src/themes/kanagawa.ts",
      "src/themes/dracula.ts",
    ];
    await Promise.all(
      requiredSource.map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/theme");
  });

  it("keeps the complete shortcut implementation only in shortcuts-native", async () => {
    await expect(
      fs.stat(join(root, "src/modules/shortcuts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const owner = join(root, "plugin-repository/plugins/shortcuts-native");
    await Promise.all(
      [
        "src/model.ts",
        "src/model.test.ts",
        "src/renderer.ts",
        "src/renderer.test.tsx",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/shortcuts");
  });

  it("keeps update behavior and exact overlay UI only in updater-native", async () => {
    await Promise.all(
      [
        "src/modules/updater",
        "src/native/updater.ts",
        "src/native/process.ts",
        "electron/main/plugin-repository/plugins/updater",
        "resources/plugin-repository/plugins/updater",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const owner = join(root, "core-plugins/updater-native");
    await Promise.all(
      [
        "src/main.ts",
        "src/renderer.tsx",
        "src/renderer.test.ts",
        "src/metadata.ts",
        "src/ui/UpdaterDialog.tsx",
        "src/ui/UpdaterDialog.test.tsx",
        "src/ui/ManualInstallPanel.tsx",
        "src/ui/useUpdater.ts",
        "src/ui/useUpdater.test.ts",
        "src/ui/releaseCheck.ts",
        "src/ui/distroCommand.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const manifest = JSON.parse(
      await fs.readFile(join(owner, "termco-plugin.json"), "utf8"),
    ) as {
      entrypoints: Record<string, string>;
    };
    expect(manifest.entrypoints).toEqual({
      main: "src/main.ts",
      renderer: "src/renderer.tsx",
    });

    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/updater");
  });

  it("keeps About presentation separate from stable application identity", async () => {
    await expect(
      fs.stat(join(root, "src/settings/sections/AboutSection.tsx")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const owner = join(root, "plugin-repository/plugins/about-native");
    await Promise.all(
      ["src/renderer.tsx", "src/renderer.test.tsx", "src/model.ts"].map(
        (relative) =>
          expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const identityOwner = join(
      root,
      "plugin-repository/plugins/application-identity-native",
    );
    await Promise.all(
      ["src/main.ts", "src/renderer.ts", "assets/termco-icon.png"].map(
        (relative) =>
          expect(fs.stat(join(identityOwner, relative))).resolves.toBeTruthy(),
      ),
    );
    await expect(
      fs.stat(
        join(root, "core-plugins/settings-native/assets/termco-icon.png"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const source = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(source).not.toContain("style={{");
    expect(source).toContain("termco-ai/termco");
    expect(source).toContain("Globe02Icon");
    expect(source).toContain("useSyncExternalStore");
    expect(source).not.toContain('context.provide("application.branding"');
  });

  it("keeps the exact complete General settings UI in general-settings", async () => {
    const owner = join(root, "plugin-repository/plugins/general-settings");
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/renderer.test.tsx",
        "src/model.ts",
        "src/model.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const source = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(source).not.toContain("style={{");
    expect(source).toContain("termco-section-label mb-2");
    expect(source).toContain("py-(--settings-row-pad)");
    expect(source).toContain("<ui.Switch");
    expect(source).toContain("<ui.Slider");
    expect(source).toContain("preferences.subscribe");
  });

  it("composes settings only from the selected section registry", async () => {
    await expect(
      fs.stat(join(root, "src/core/services/settings.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(join(root, "src/core/services/settings.test.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const settingsSource = await fs.readFile(
      join(root, "core-plugins/settings-native/src/renderer.tsx"),
      "utf8",
    );
    expect(settingsSource).not.toContain("UiWorkspaceViewRuntime");
    expect(settingsSource).not.toContain("additionalSettingsSections");
    expect(settingsSource).toContain("sectionRegistry.records");
    expect(settingsSource).toContain("sectionRegistry.subscribe");

    const contract = await fs.readFile(
      join(root, "plugin-repository/plugins/ui-settings-base/src/index.ts"),
      "utf8",
    );
    expect(contract).not.toContain("UiWorkspaceViewRuntime");
    expect(contract).not.toContain("subscribeAdditionalSettingsSections");
  });

  it("keeps the exact complete Appearance settings UI in appearance-settings", async () => {
    const owner = join(root, "plugin-repository/plugins/appearance-settings");
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/renderer.test.tsx",
        "src/editorThemes.ts",
        "src/editorThemes.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const source = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(source).not.toContain("const panel =");
    expect(source).not.toContain("const row =");
    expect(source).toContain("ComputerIcon");
    expect(source).toContain("<ui.Select");
    expect(source).toContain("<ui.Slider");
    expect(source).toContain("useSyncExternalStore");
    expect(source).toContain('theme.mutate({ type: "set-theme"');
  });

  it.each([
    ["terminal-settings", "Rendering", "<ui.Select", "<ui.Switch"],
    ["editor-settings", "Behavior", "<ui.Input", "<ui.Switch"],
  ])("keeps the exact complete settings UI in %s", async (pluginName, sectionLabel, firstControl, secondControl) => {
    const owner = join(featurePluginsRoot, pluginName);
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/renderer.test.tsx",
        "src/model.ts",
        "src/model.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const source = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(source).not.toContain("style={{");
    expect(source).toContain("termco-section-label mb-2");
    expect(source).toContain("py-(--settings-row-pad)");
    expect(source).toContain(sectionLabel);
    expect(source).toContain(firstControl);
    expect(source).toContain(secondControl);
    expect(source).toContain("preferences.subscribe");
  });

  it.each([
    ["shortcuts-settings", "Filter shortcuts", "<ui.Kbd", "<ui.AlertDialog"],
    ["languages-settings", "Language servers", "<ui.Dialog", "<ui.Badge"],
  ])("keeps the complete interactive settings product in %s", async (pluginName, productText, firstControl, secondControl) => {
    const owner = join(featurePluginsRoot, pluginName);
    await Promise.all(
      ["src/renderer.tsx", "src/renderer.test.tsx"].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const source = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(source).not.toContain("style={{");
    expect(source).toContain("termco-section-label");
    expect(source).toContain(productText);
    expect(source).toContain(firstControl);
    expect(source).toContain(secondControl);
  });

  it("keeps the complete model configuration product in models-settings", async () => {
    const owner = join(root, "plugin-repository/plugins/models-settings");
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/renderer.test.ts",
        "src/renderer.ui.test.tsx",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const source = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(source).not.toContain("style={{");
    expect(source).toContain("termco-section-label");
    expect(source).toContain("function DefaultModelPicker");
    expect(source).toContain("<ui.Popover");
    expect(source).toContain("onChange(model.id)");
    expect(source).toContain("<ui.Switch");
    expect(source).toContain("ChatGptIcon");
    expect(source).toContain("ProviderAvatar");
    expect(source).toContain("<ui.AlertDialog");
    expect(source).toContain("Connect a model source");
    expect(source).toContain("preferences.subscribe");
    expect(source).toContain("secrets.getAll");
  });

  it("does not retain the unused host SSH state bridge", async () => {
    await expect(
      fs.stat(join(root, "src/modules/ssh-state")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(
        join(
          root,
          "plugin-repository/plugins/ssh-native/src/stateHub.client.test.ts",
        ),
      ),
    ).resolves.toBeTruthy();
    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/ssh-state");
  });

  it("keeps the complete ports feature only in ports-sidebar", async () => {
    await expect(
      fs.stat(join(root, "src/modules/ports")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const owner = join(root, "plugin-repository/plugins/ports-sidebar");
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/renderer.test.tsx",
        "src/PortsPanel.tsx",
        "src/model.ts",
        "src/model.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const panel = await fs.readFile(join(owner, "src/PortsPanel.tsx"), "utf8");
    expect(panel).not.toMatch(/style=|↗|⧉|＋|▶|■/);
    expect(panel).toContain("Globe02Icon");
    expect(panel).toContain("ssh:state-changed");
    const renderer = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(renderer).toContain("ArrowDataTransferHorizontalIcon");

    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/ports");
  });

  it("routes the host Agents affordances through the plugin-owned capability", async () => {
    await expect(
      fs.stat(join(root, "src/modules/agents-manager")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const owner = join(root, "plugin-repository/plugins/agents-manager-native");
    await Promise.all(
      ["src/plugin.tsx", "src/viewState.ts", "src/viewState.test.ts"].map(
        (relative) =>
          expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/agents-manager");
  });

  it("keeps the exact Source Control product only in source-control-sidebar", async () => {
    await expect(
      fs.stat(join(root, "src/modules/source-control")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const owner = join(
      root,
      "plugin-repository/plugins/source-control-sidebar",
    );
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/runtime.ts",
        "src/context.ts",
        "src/context.test.ts",
        "src/navigation.ts",
        "src/navigation.test.ts",
        "src/baseline/SourceControlPanel.tsx",
        "src/baseline/SourceControlPanel.test.tsx",
        "src/baseline/SourceControlPanel.virtualizer.test.tsx",
        "src/baseline/components/BranchDropdown.tsx",
        "src/baseline/components/ChangedFileList.tsx",
        "src/baseline/components/CommitComposer.tsx",
        "src/baseline/components/DiscardDialog.tsx",
        "src/baseline/useSourceControl/useSourceControl.ts",
        "src/baseline/useSourceControl/useSourceControl.test.ts",
        "src/baseline/useSourceControlPanel/useSourceControlPanel.ts",
        "src/baseline/useSourceControlPanel/useSourceControlPanel.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const runtimeSurface = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(runtimeSurface).not.toContain("app/modules/source-control");
  });

  it("keeps the exact Git history and diff product only in git-surface", async () => {
    await expect(
      fs.stat(join(root, "src/modules/git-history")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await Promise.all(
      [
        "src/modules/editor/components/GitDiffPane.tsx",
        "src/modules/editor/components/GitDiffStack.tsx",
        "src/modules/editor/lib/diffCache.ts",
        "src/modules/editor/lib/gitDiffLoadState.ts",
        "src/modules/editor/lib/gitDiffStats.ts",
        "src/modules/editor/lib/gitDiffTheme.ts",
        "src/modules/editor/lib/ignoreWhitespaceDiff.ts",
        "src/modules/editor/lib/useMergeView.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const owner = join(root, "plugin-repository/plugins/git-surface");
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/runtime.ts",
        "src/tabs.ts",
        "src/tabs.test.ts",
        "src/baseline/git-history/GitHistoryPane.tsx",
        "src/baseline/git-history/GitHistoryPane.test.tsx",
        "src/baseline/git-history/components/CommitRow.tsx",
        "src/baseline/git-history/components/GraphRail.tsx",
        "src/baseline/git-history/hooks/useCommitLog.ts",
        "src/baseline/git-history/lib/graph.ts",
        "src/baseline/git-diff/components/GitDiffPane.tsx",
        "src/baseline/git-diff/components/GitDiffPane.test.tsx",
        "src/baseline/git-diff/lib/diffCache.ts",
        "src/baseline/git-diff/lib/useMergeView.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const sourceFiles = await fs.readdir(join(owner, "src"), {
      recursive: true,
    });
    const sourceText = await Promise.all(
      sourceFiles
        .filter((relative) => /\.(?:ts|tsx)$/.test(relative))
        .map((relative) => fs.readFile(join(owner, "src", relative), "utf8")),
    );
    expect(sourceText.join("\n")).not.toMatch(
      /from\s+["'](?:@\/|@termco\/app|(?:\.\.\/)+\.\.\/src\/)/,
    );
  });

  it("keeps the exact AI diff-review product only in ai-diff-surface", async () => {
    await Promise.all(
      [
        "src/modules/editor/components/AiDiffPane.tsx",
        "src/modules/editor/components/AiDiffStack.tsx",
        "src/modules/editor/components/AiDiffStackLazy.tsx",
        "src/modules/editor/lib/aiDiffStats.ts",
        "src/modules/editor/lib/aiDiffTheme.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const owner = join(root, "plugin-repository/plugins/ai-diff-surface");
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/runtime.ts",
        "src/tabs.ts",
        "src/tabs.test.ts",
        "src/baseline/components/AiDiffPane.tsx",
        "src/baseline/components/AiDiffPane.test.tsx",
        "src/baseline/components/AiDiffStack.tsx",
        "src/baseline/components/AiDiffStack.test.tsx",
        "src/baseline/components/AiDiffStackLazy.tsx",
        "src/baseline/lib/aiDiffStats.ts",
        "src/baseline/lib/aiDiffTheme.ts",
        "src/baseline/lib/useMergeView.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const sourceFiles = await fs.readdir(join(owner, "src"), {
      recursive: true,
    });
    const sourceText = await Promise.all(
      sourceFiles
        .filter((relative) => /\.(?:ts|tsx)$/.test(relative))
        .map((relative) => fs.readFile(join(owner, "src", relative), "utf8")),
    );
    expect(sourceText.join("\n")).not.toMatch(
      /from\s+["'](?:@\/|@termco\/app|(?:\.\.\/)+\.\.\/src\/)/,
    );
  });

  it("activates the exact AI chat and model-browser source from ai-chat-native", async () => {
    const owner = join(root, "plugin-repository/plugins/ai-chat-native");
    await expect(
      fs.stat(join(root, "src/core/services/aiActions.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(join(root, "src/plugin-repository/plugins/ai")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await Promise.all(
      [
        "src/ui/AiSurfaces.tsx",
        "src/ui/AiSurfaces.test.tsx",
        "src/ui/WorkspaceComposer.tsx",
        "src/baseline/components/AiDockPanel/AiDockPanel.tsx",
        "src/baseline/components/AiMiniWindow/AiMiniWindow.tsx",
        "src/baseline/components/AiComposer/AiComposer.tsx",
        "src/baseline/components/AiStatusBarControls/ModelDropdown.tsx",
        "src/baseline/components/AiStatusBarControls/ModelDropdown.test.tsx",
        "src/baseline/components/AgentRunBridge/AgentRunBridge.tsx",
        "src/baseline/lib/composer/provider.tsx",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    await Promise.all(
      [
        "src/ui/ModelDropdown.tsx",
        "src/ui/ModelRow.tsx",
        "src/ui/modelPickerRuntime.ts",
        "src/ui/providerIcons.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const surface = await fs.readFile(
      join(owner, "src/ui/AiSurfaces.tsx"),
      "utf8",
    );
    expect(surface).toContain(
      'import { AiDockPanel } from "../baseline/components/AiDockPanel/AiDockPanel"',
    );
    expect(surface).toContain(
      'import { AiMiniWindow } from "../baseline/components/AiMiniWindow/AiMiniWindow"',
    );
    expect(surface).toContain(
      'import { AiComposerProvider } from "../baseline/lib/composer"',
    );

    const sourceFiles = await fs.readdir(join(owner, "src"), {
      recursive: true,
    });
    const sourceText = await Promise.all(
      sourceFiles
        .filter((relative) => /\.(?:ts|tsx)$/.test(relative))
        .map((relative) => fs.readFile(join(owner, "src", relative), "utf8")),
    );
    expect(sourceText.join("\n")).not.toMatch(
      /from\s+["'](?:@\/|@termco\/app|(?:\.\.\/)+\.\.\/src\/)/,
    );
  });

  it("composes the exact block input footer without cross-plugin source imports", async () => {
    const owner = join(
      root,
      "plugin-repository/plugins/terminal-surface-native",
    );
    const integration = join(
      root,
      "plugin-repository/plugins/terminal-workspace-footer-native",
    );
    await Promise.all(
      [
        "src/footer/WorkspaceFooter.tsx",
        "src/footer/WorkspaceFooter.test.tsx",
        "src/footer/ModeToggle.tsx",
        "src/terminal/block/ShellInput.tsx",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const integrationRenderer = await fs.readFile(
      join(integration, "src/renderer.ts"),
      "utf8",
    );
    expect(integrationRenderer).not.toMatch(
      /from\s+["'](?:@\/|@termco\/app|\.\.\/\.\.\/terminal-surface-native)/,
    );

    const footer = await fs.readFile(
      join(owner, "src/footer/WorkspaceFooter.tsx"),
      "utf8",
    );
    expect(footer).not.toMatch(/from\s+["'](?:@\/|@termco\/app)/);
    expect(footer).not.toContain("plugin-repository/plugins/ai-chat-native");
  });

  it("keeps preference persistence and change publication in one replaceable provider", async () => {
    const owner = join(root, "plugin-repository/plugins/preferences-json");
    await Promise.all(
      ["src/main.ts", "src/preferences.ts", "src/preferences.test.ts"].map(
        (relative) =>
          expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    await expect(
      fs.stat(join(root, "src/modules/settings")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const provider = await fs.readFile(
      join(owner, "src/preferences.ts"),
      "utf8",
    );
    expect(provider).toContain("PREFERENCES_STORE");
    expect(provider).toContain("PREFERENCES_CHANGED_EVENT");
    expect(provider).toContain("handle.save()");

    await expect(fs.stat(join(root, "src/core/boot.ts"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    const rendererMain = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(rendererMain).not.toMatch(
      /modules\/(?:settings|terminal)|writeToSession|sessions\?\.write/,
    );
  });

  it("keeps rig metadata and saved tab layouts behind their selected providers", async () => {
    await expect(
      fs.stat(join(root, "src/modules/rigs/lib/store.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await Promise.all(
      [
        "src/modules/rigs/RigSwitcher.tsx",
        "src/modules/rigs/RigTabStrip.tsx",
        "src/modules/rigs/components/RigRow.tsx",
        "src/modules/rigs/hooks/useRigDrag.ts",
        "src/modules/rigs/lib/cycleRig.ts",
        "src/modules/rigs/lib/rigEvents.ts",
        "src/modules/rigs/lib/useRigOverview.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    await Promise.all(
      [
        "plugin-repository/plugins/header-native/src/baseline/rigs/RigSwitcher.tsx",
        "plugin-repository/plugins/header-native/src/baseline/rigs/RigTabStrip.tsx",
        "plugin-repository/plugins/header-native/src/baseline/rigs/hooks/useRigDrag.ts",
        "plugin-repository/plugins/header-native/src/baseline/rigs/RigSwitcher.test.tsx",
        "plugin-repository/plugins/header-native/src/rigOverview.ts",
        "plugin-repository/plugins/header-native/src/rigOverview.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).resolves.toBeTruthy(),
      ),
    );
    await expect(
      fs.stat(join(root, "src/modules/rigs/lib/useRigs.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await Promise.all(
      ["src/modules/rigs/index.ts", "src/modules/rigs/lib/model.ts"].map(
        (relative) =>
          expect(fs.stat(join(root, relative))).rejects.toMatchObject({
            code: "ENOENT",
          }),
      ),
    );
    await Promise.all(
      [
        "src/modules/rigs/lib/activeRig.ts",
        "src/modules/rigs/lib/activeRig.test.ts",
        "src/modules/rigs/lib/runRigsBoot.ts",
        "src/modules/rigs/lib/runRigsBoot.test.ts",
        "src/modules/rigs/lib/useRigsBoot.ts",
        "src/modules/rigs/lib/useRigsBoot.test.ts",
        "src/modules/rigs/lib/useRigPersistence.ts",
        "src/modules/rigs/lib/useRigPersistence.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const pluginRigBoot = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/lib/runRigsBoot.ts",
      ),
      "utf8",
    );
    expect(pluginRigBoot).toMatch(
      /rigs: WorkspaceRigsCapability|workspaceTabs: WorkspaceTabsCapability|workspaceRegistry: WorkspaceCapability/,
    );
    expect(pluginRigBoot).not.toMatch(
      /workspaceRigsAccess|workspaceTabsAccess|modules\/settings|modules\/ai\/lib\/native/,
    );
    const pluginRigPersistence = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useRigPersistence.ts",
      ),
      "utf8",
    );
    expect(pluginRigPersistence).toContain(
      "workspaceTabs: WorkspaceTabsCapability",
    );
    expect(pluginRigPersistence).not.toMatch(
      /workspaceTabsAccess|selectedWorkspaceTabs/,
    );
    await expect(
      fs.stat(join(root, "src/platform/workspaceRigsAccess.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const workspaceRenderer = await fs.readFile(
      join(root, "core-plugins/workspace-shell-native/src/renderer.tsx"),
      "utf8",
    );
    const workspaceSources = await Promise.all(
      [
        "core-plugins/workspace-shell-native/src/workspace/Workspace.tsx",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useRigSync.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useWorkspaceControls.ts",
      ].map((relative) => fs.readFile(join(root, relative), "utf8")),
    );
    expect(workspaceRenderer).toContain(
      "rigs: live(WORKSPACE_RIGS_SERVICE, fallbackRigs)",
    );
    expect(workspaceRenderer).toContain(
      "rigOverview: live(WORKSPACE_RIGS_OVERVIEW_SERVICE, fallbackRigOverview)",
    );
    expect(workspaceRenderer).toContain(
      "workspaceRegistry: live(WORKSPACE_REGISTRY_SERVICE, EMPTY_WORKSPACE_REGISTRY)",
    );
    expect(workspaceSources.join("\n")).not.toMatch(
      /workspaceRigsAccess|selectedWorkspaceRigs|useWorkspaceRigs|workspaceRigsSnapshot/,
    );

    await Promise.all(
      [
        "src/modules/tabs/lib/nextActiveInRig.test.ts",
        "src/modules/tabs/lib/pickTabByRigIndex.test.ts",
        "src/modules/tabs/lib/reorderTabsByGap.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    await expect(fs.stat(join(root, "src/modules/tabs"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
    const tabsProvider = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/workspace-tabs-native/src/store.ts",
      ),
      "utf8",
    );
    expect(tabsProvider).toMatch(
      /nextActiveInRig|selectByRigIndex|close\(tabId|moveToRig|reorderAcrossRigs|reorderByGap/,
    );
    expect(tabsProvider).toContain('focusedPane: "left"');
    const splitPaneConsumer = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useSplitPanes.ts",
      ),
      "utf8",
    );
    expect(splitPaneConsumer).not.toMatch(/useState|setFocusedPane/);
    expect(splitPaneConsumer).toContain('focusedPane: "left" | "right"');
    await expect(
      fs.stat(
        join(
          root,
          "core-plugins/workspace-shell-native/src/workspace/hooks/useRigActions.ts",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const rigWorkflows = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/workspace-rig-workflows-native/src/workflows.ts",
      ),
      "utf8",
    );
    expect(rigWorkflows).toContain("dependencies.tabs.transition(");
    expect(rigWorkflows).toContain("dependencies.terminalSessions.open(");
    expect(rigWorkflows).toContain("dependencies.rigs.activate(");
    expect(rigWorkflows).not.toMatch(/setActiveId|tabsRef/);
    const aiTabsConsumer = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-chat-native/src/ui/AiSurfaces.tsx",
      ),
      "utf8",
    );
    expect(aiTabsConsumer).toContain("tabs.nextActiveInRig(target.id)");
  });

  it("keeps the new-file workflow only in editor-surface-native", async () => {
    await Promise.all(
      [
        "src/modules/editor/components/NewEditorDialog.tsx",
        "src/modules/editor/components/NewEditorDialog.test.tsx",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const owner = join(root, "plugin-repository/plugins/editor-surface-native");
    await Promise.all(
      [
        "src/editor/components/NewEditorDialog.tsx",
        "src/newFile.ts",
        "src/newFile.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const hostOverlays = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/components/AppOverlays.tsx",
      ),
      "utf8",
    );
    expect(hostOverlays).not.toMatch(/NewEditorDialog|newEditorOpen/);
    const hostShortcuts = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useAppShortcuts.ts",
      ),
      "utf8",
    );
    expect(hostShortcuts).toContain(
      "editorNavigation: EditorNavigationCapability",
    );
    expect(hostShortcuts).not.toContain("rendererCapabilityAccess");
    expect(hostShortcuts).not.toContain("setNewEditorOpen");
  });

  it("keeps the exact global notification host only in ui-shell-native", async () => {
    await Promise.all(
      ["src/components/ui/sonner.tsx", "src/components/ui/sonner.test.tsx"].map(
        (relative) =>
          expect(fs.stat(join(root, relative))).rejects.toMatchObject({
            code: "ENOENT",
          }),
      ),
    );

    const owner = join(root, "core-plugins/ui-shell-native");
    const shell = await fs.readFile(join(owner, "src/shell.ts"), "utf8");
    const renderer = await fs.readFile(join(owner, "src/renderer.ts"), "utf8");
    const manifest = JSON.parse(
      await fs.readFile(join(owner, "termco-plugin.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const hostOverlays = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/components/AppOverlays.tsx",
      ),
      "utf8",
    );

    expect(renderer).toContain('import { Toaster } from "sonner"');
    expect(shell).toContain('position: "bottom-right"');
    expect(shell).toContain('className: "toaster group"');
    expect(shell).toContain('"--normal-bg": "var(--card)"');
    expect(shell).toContain('"--border-radius": "10px"');
    expect(manifest.dependencies).toEqual(
      expect.objectContaining({ sonner: "^2.0.7" }),
    );
    expect(hostOverlays).not.toMatch(/Toaster|sonner/);
  });

  it("keeps complete tab chrome only in the selected header plugin", async () => {
    await Promise.all(
      [
        "src/modules/tabs/TabBar.tsx",
        "src/modules/tabs/TabSwitcherHud.tsx",
        "src/modules/tabs/components/TabIcon.tsx",
        "src/modules/tabs/components/TabStripItem.tsx",
        "src/modules/tabs/lib/useSplitDrag.ts",
        "src/modules/tabs/lib/useTabSwitcher.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useMruSwitcher.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    await Promise.all(
      [
        "plugin-repository/plugins/header-native/src/baseline/tabs/TabBar.tsx",
        "plugin-repository/plugins/header-native/src/baseline/tabs/TabBar.test.tsx",
        "plugin-repository/plugins/header-native/src/baseline/tabs/TabSwitcherHud.tsx",
        "plugin-repository/plugins/header-native/src/baseline/tabs/components/TabIcon.tsx",
        "plugin-repository/plugins/header-native/src/baseline/tabs/components/TabStripItem.tsx",
        "plugin-repository/plugins/header-native/src/baseline/tabs/lib/useSplitDrag.ts",
        "plugin-repository/plugins/header-native/src/baseline/tabs/lib/useHeaderTabSwitcher.ts",
        "plugin-repository/plugins/header-native/src/baseline/tabs/lib/useHeaderTabSwitcher.test.tsx",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).resolves.toBeTruthy(),
      ),
    );

    const workspaceColumn = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/components/WorkspaceColumn.tsx",
      ),
      "utf8",
    );
    expect(workspaceColumn).toContain("UiTabPresentationCapability");
    expect(workspaceColumn).not.toContain("tabPresentationAccess");
    expect(workspaceColumn).not.toMatch(/TabIcon|useSplitDrag|overSplit/);
    const hostShortcuts = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useAppShortcuts.ts",
      ),
      "utf8",
    );
    expect(hostShortcuts).not.toMatch(/["']tab\.(?:next|prev)["']/);
  });

  it("keeps header search focus inside the replaceable header provider", async () => {
    const headerRenderer = await fs.readFile(
      join(root, "plugin-repository/plugins/header-native/src/renderer.tsx"),
      "utf8",
    );
    const exactHeader = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/header-native/src/baseline/ExactHeader.tsx",
      ),
      "utf8",
    );
    const workspaceRenderer = await fs.readFile(
      join(root, "core-plugins/workspace-shell-native/src/renderer.tsx"),
      "utf8",
    );
    expect(headerRenderer).toContain(
      'context.provide<UiHeaderSearchCapability>("ui.header-search", headerSearch)',
    );
    expect(exactHeader).toContain("headerSearch.register(");
    expect(workspaceRenderer).toContain(
      "headerSearch: live(UI_HEADER_SEARCH_SERVICE, EMPTY_HEADER_SEARCH)",
    );
    await expect(
      fs.stat(join(root, "src/core/services/headerView.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(main).not.toMatch(
      /provideV2HeaderView|registerSearchFocus|headerView/,
    );
  });

  it("keeps surface search registration in its selected provider", async () => {
    const workspaceManifest = JSON.parse(
      await fs.readFile(
        join(root, "core-plugins/workspace-shell-native/termco-plugin.json"),
        "utf8",
      ),
    ) as {
      transitionalHostImports?: string[];
    };
    expect(workspaceManifest.transitionalHostImports ?? []).not.toEqual(
      expect.arrayContaining([
        "@/core/services/searchTarget",
        "@/platform/surfaceSearch",
      ]),
    );
    await Promise.all(
      [
        "src/core/services/searchTarget.ts",
        "src/platform/surfaceSearch.ts",
        "src/platform/surfaceSearch.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const workspaceRenderer = await fs.readFile(
      join(root, "core-plugins/workspace-shell-native/src/renderer.tsx"),
      "utf8",
    );
    expect(workspaceRenderer).toContain("createLiveSurfaceSearchFacade(");
    expect(workspaceRenderer).toContain(
      "surfaceSearch: surfaceSearchFacade.value",
    );
  });

  it("keeps the block-input signal in its owning base package", async () => {
    await expect(
      fs.stat(join(root, "src/core/services/workspaceInput.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const workspaceManifest = JSON.parse(
      await fs.readFile(
        join(root, "core-plugins/workspace-shell-native/termco-plugin.json"),
        "utf8",
      ),
    ) as { transitionalHostImports?: string[] };
    expect(workspaceManifest.transitionalHostImports ?? []).not.toContain(
      "@/core/services/workspaceInput",
    );

    const shortcuts = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useAppShortcuts.ts",
      ),
      "utf8",
    );
    const footer = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/terminal-surface-native/src/footer/WorkspaceFooter.tsx",
      ),
      "utf8",
    );
    expect(shortcuts).toMatch(
      /import\s+\{[^}]*TOGGLE_BLOCK_INPUT_EVENT[^}]*\}\s+from\s+["']@termco\/ui-workspace-base["']/s,
    );
    expect(footer).toMatch(
      /import\s+(?:type\s+)?\{[^}]*TOGGLE_BLOCK_INPUT_EVENT[^}]*\}\s+from\s+["']@termco\/ui-workspace-base["']/s,
    );
    expect(`${shortcuts}\n${footer}`).not.toContain(
      "@/core/services/workspaceInput",
    );
    expect(footer).not.toMatch(
      /const\s+TOGGLE_BLOCK_INPUT_EVENT\s*=\s*["']termco:toggle-block-input["']/,
    );

    const registry = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(registry).not.toContain("workspaceInput");
  });

  it("keeps workspace commands and agent cwd inside the workspace plugin", async () => {
    const manifest = JSON.parse(
      await fs.readFile(
        join(root, "core-plugins/workspace-shell-native/termco-plugin.json"),
        "utf8",
      ),
    ) as {
      transitionalHostImports?: string[];
    };
    expect(manifest.transitionalHostImports ?? []).not.toEqual(
      expect.arrayContaining([
        "@/core/services/agentCwd",
        "@/core/services/palette",
      ]),
    );

    const renderer = await fs.readFile(
      join(root, "core-plugins/workspace-shell-native/src/renderer.tsx"),
      "utf8",
    );
    const commandHook = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useWorkspaceCoreCommands.ts",
      ),
      "utf8",
    );
    expect(renderer).toContain("UI_COMMANDS_SERVICE");
    expect(renderer).toMatch(/\.register\(\s*commands\.contribution,/);
    expect(commandHook).not.toContain("@/core/services/palette");

    await expect(
      fs.stat(join(root, "src/core/services/agentCwd.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const workspace = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/Workspace.tsx",
      ),
      "utf8",
    );
    expect(workspace).toContain("useState<string | null>(null)");
    expect(workspace).not.toContain("useAgentCwdStore");
  });

  it("publishes workspace header and sidebar state through a replaceable provider", async () => {
    const workspaceManifest = JSON.parse(
      await fs.readFile(
        join(root, "core-plugins/workspace-shell-native/termco-plugin.json"),
        "utf8",
      ),
    ) as {
      transitionalHostImports?: string[];
    };
    expect(workspaceManifest.transitionalHostImports ?? []).not.toContain(
      "@/core/services/workspacePresentationState",
    );

    await expect(
      fs.stat(join(root, "src/core/services/workspacePresentationState.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const registry = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    const pluginTypes = await fs.readFile(
      join(root, "tsconfig.plugins.json"),
      "utf8",
    );
    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    const headerRuntime = await fs.readFile(
      join(root, "plugin-repository/plugins/header-native/src/runtime.tsx"),
      "utf8",
    );
    const statusbarRuntime = await fs.readFile(
      join(root, "plugin-repository/plugins/statusbar-native/src/runtime.tsx"),
      "utf8",
    );
    expect(`${registry}\n${pluginTypes}\n${main}`).not.toContain(
      "workspacePresentationState",
    );
    expect(`${headerRuntime}\n${statusbarRuntime}`).toContain(
      "WorkspacePresentationCapability",
    );
    expect(`${headerRuntime}\n${statusbarRuntime}`).not.toMatch(
      /workspacePresentationAccess|@\//,
    );
  });

  it("owns the shared AI live registry in a replaceable provider plugin", async () => {
    const workspaceManifest = JSON.parse(
      await fs.readFile(
        join(root, "core-plugins/workspace-shell-native/termco-plugin.json"),
        "utf8",
      ),
    ) as {
      transitionalHostImports?: string[];
    };
    expect(workspaceManifest.transitionalHostImports ?? []).not.toContain(
      "@/core/services/aiLive",
    );

    await Promise.all(
      ["src/core/services/aiLive.ts", "src/core/services/aiLive.test.ts"].map(
        (relative) =>
          expect(fs.stat(join(root, relative))).rejects.toMatchObject({
            code: "ENOENT",
          }),
      ),
    );
    const hostSources = await Promise.all(
      [
        "src/core/runtime/registry.ts",
        "tsconfig.plugins.json",
        "src/main.tsx",
      ].map((relative) => fs.readFile(join(root, relative), "utf8")),
    );
    expect(hostSources.join("\n")).not.toMatch(
      /aiLiveService|services\/aiLive|["']ai-live["']/,
    );
    const storeTypes = await fs.readFile(
      join(root, "plugin-repository/plugins/ai-chat-native/src/store/types.ts"),
      "utf8",
    );
    expect(storeTypes).toContain("AiLiveCapability");
    expect(storeTypes).not.toMatch(/getTerminalContext\(rigId/);
  });

  it("routes current-window behavior through the replaceable desktop provider", async () => {
    for (const pluginId of ["workspace-shell-native", "header-native"]) {
      const manifest = JSON.parse(
        await fs.readFile(
          join(pluginRoot(pluginId), "termco-plugin.json"),
          "utf8",
        ),
      ) as {
        transitionalHostImports?: string[];
      };
      expect(manifest.transitionalHostImports ?? []).not.toContain(
        "@/native/window",
      );
    }

    const closeGuard = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useAppCloseGuard.ts",
      ),
      "utf8",
    );
    const windowTitle = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useWindowTitle.ts",
      ),
      "utf8",
    );
    expect(`${closeGuard}\n${windowTitle}`).toContain(
      "DesktopWindowCapability",
    );
    expect(`${closeGuard}\n${windowTitle}`).not.toContain("@/native/window");
    await Promise.all(
      [
        "src/modules/tabs/lib/useWindowTitle.ts",
        "src/modules/tabs/lib/useWindowTitle.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const headerRenderer = await fs.readFile(
      join(root, "plugin-repository/plugins/header-native/src/renderer.tsx"),
      "utf8",
    );
    expect(headerRenderer).toContain(
      "const desktopWindow = live(DESKTOP_WINDOW_SERVICE, EMPTY_DESKTOP_WINDOW)",
    );
    expect(headerRenderer).toContain("requires: [DESKTOP_WINDOW_SERVICE]");
    expect(headerRenderer).toContain(
      "scope.get<DesktopWindowCapability>(DESKTOP_WINDOW_SERVICE)",
    );
    const headerRuntime = await fs.readFile(
      join(root, "plugin-repository/plugins/header-native/src/runtime.tsx"),
      "utf8",
    );
    expect(headerRuntime).toContain("DesktopWindowCapability");
    expect(headerRuntime).not.toContain("@/native/window");
    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(main).not.toContain("@/native/window");
    expect(main).toMatch(
      /platformCapability<DesktopWindowCapability>\(\s*["']desktop\.window["']/,
    );
    await Promise.all(
      [
        "src/components/WindowControls.tsx",
        "src/components/WindowControls.test.tsx",
        "src/modules/ai/lib/skills/useSkillsDetector.ts",
        "src/native/window.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const registry = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(registry).not.toContain('"app/native/window"');
  });

  it("keeps settings in-window and launch-directory state in workspace-native", async () => {
    await Promise.all(
      [
        "electron/main/plugin-repository/plugins/window",
        "src/lib/launchDir.ts",
        "src/lib/launchDir.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const rendererMain = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(rendererMain).not.toMatch(/initLaunchDir|get_launch_dir/);

    const nativeWindowHost = await fs.readFile(
      join(root, "electron/main/windows.ts"),
      "utf8",
    );
    expect(nativeWindowHost).not.toContain('entry: "index" | "settings"');
    expect(nativeWindowHost).not.toContain('label: "settings"');

    const launchHost = await fs.readFile(
      join(root, "electron/main/launch.ts"),
      "utf8",
    );
    expect(launchHost).not.toContain("takeLaunchDir");

    const workspaceProvider = await fs.readFile(
      join(root, "plugin-repository/plugins/workspace-native/src/workspace.ts"),
      "utf8",
    );
    const workspaceEnvironment = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/workspace-environment-native/src/environment.ts",
      ),
      "utf8",
    );
    expect(workspaceProvider).toContain("currentDir: () =>");
    expect(workspaceEnvironment).toContain(
      "dependencies.workspace.currentDir()",
    );

    const settingsOwner = await fs.readFile(
      join(root, "core-plugins/settings-native/src/renderer.tsx"),
      "utf8",
    );
    expect(settingsOwner).toContain('context.provide("ui.settings-view"');
  });

  it("routes desktop integration only through the selected desktop-native provider", async () => {
    await Promise.all(
      [
        "electron/main/plugin-repository/plugins/electron-shim",
        "src/native/autostart.ts",
        "src/native/clipboard.ts",
        "src/native/notification.ts",
        "src/native/opener.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const sourceOwnedConsumers = await Promise.all(
      [
        "plugin-repository/plugins/agent-activity-native/src/renderer.tsx",
        "plugin-repository/plugins/terminal-surface-native/src/runtime.ts",
        "plugin-repository/plugins/terminal-surface-native/src/terminal/lib/terminalClipboard.ts",
      ].map((relative) => fs.readFile(join(root, relative), "utf8")),
    );
    const pluginSource = sourceOwnedConsumers.join("\n");
    expect(pluginSource).toContain("DesktopIntegrationCapability");
    expect(pluginSource).toMatch(
      /desktop\.integration|terminalRuntime\(\)\.desktop/,
    );
    expect(pluginSource).not.toMatch(
      /opener_open_|autostart_|clipboard_(?:read|write)_text|notification_send|@\/native\/(?:autostart|clipboard|notification|opener)/,
    );
  });

  it("routes HTTP only through the selected http-native provider", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/net")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/http-native/src/main.ts"),
      "utf8",
    );
    expect(provider).toContain('context.provide("network.http", capability)');
    expect(provider).not.toMatch(/lm_ping|ai_http_(?:request|stream)/);
  });

  it("routes MCP clients only through the selected mcp-native provider", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/mcp")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const toolProvider = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-tools-mcp-native/src/renderer.ts",
      ),
      "utf8",
    );
    expect(toolProvider).toContain("MCP_CLIENTS_SERVICE");
    expect(toolProvider).toContain("context.get<McpClientsCapability>");
    expect(toolProvider).not.toContain("__termco.invoke");

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/mcp-native/src/index.ts"),
      "utf8",
    );
    expect(provider).toContain("export const clients = new Map");
    expect(provider).not.toContain(
      "electron/main/plugin-repository/plugins/mcp",
    );
  });

  it("routes secrets only through the selected secrets-native provider", async () => {
    await Promise.all(
      [
        "electron/main/plugin-repository/plugins/secrets",
        "electron/test/integration/secretsAdapter.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const e2e = await fs.readFile(
      join(root, "e2e/popup-header-clickable.spec.ts"),
      "utf8",
    );
    expect(e2e).toContain('consumerPluginId: "ai-chat-native"');
    expect(e2e).toContain('capability: "secrets.application"');
    expect(e2e).toContain('method: "set"');
    expect(e2e).not.toContain('invoke("secrets_set"');

    const backendTest = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/secrets-native/src/backend.test.ts",
      ),
      "utf8",
    );
    expect(backendTest).toContain("keeps getAll in requested account order");
    expect(backendTest).toContain("encrypts persisted secrets with Electron safeStorage");

    const consumers = await Promise.all(
      [
        "plugin-repository/plugins/ai-inference-native/src/index.ts",
        "plugin-repository/plugins/models-settings/src/renderer.tsx",
      ].map((relative) => fs.readFile(join(root, relative), "utf8")),
    );
    expect(consumers.join("\n")).toContain("SecretsCapability");
    expect(consumers.join("\n")).toContain('"secrets.application"');
    expect(consumers.join("\n")).not.toMatch(
      /secrets_(?:get|set|delete|get_all)/,
    );
  });

  it("routes session history only through the selected current-format provider", async () => {
    const e2eSources = await Promise.all(
      ["e2e/trajectory.spec.ts", "e2e/session-completeness.spec.ts"].map(
        (relative) => fs.readFile(join(root, relative), "utf8"),
      ),
    );
    const e2e = e2eSources.join("\n");
    expect(e2e).toContain('consumerPluginId: "trajectory-native"');
    expect(e2e).toContain('capability: "session.history"');
    expect(e2e).toContain('method: "list" | "readWindow"');
    expect(e2e).toContain("method: selectedMethod");
    expect(e2e).not.toContain("__termco.invoke");

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/session-native/src/main.ts"),
      "utf8",
    );
    expect(provider).toContain("JsonlSessionPersistence");
    expect(provider).toContain(
      "context.provide(SESSION_HISTORY_SERVICE, history)",
    );
  });

  it("routes embedded browser automation only through browser-native", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/browser")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const e2e = await fs.readFile(
      join(root, "e2e/web-preview.spec.ts"),
      "utf8",
    );
    expect(e2e).toContain('consumerPluginId: "preview-surface-native"');
    expect(e2e).toContain('capability: "browser.automation"');
    expect(e2e).toContain('method: "invoke"');
    expect(e2e).not.toContain("__termco.invoke");
  });

  it("routes language-server sessions only through lsp-native", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/lsp")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const editorAdapter = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/editor-surface-native/src/platform.ts",
      ),
      "utf8",
    );
    expect(editorAdapter).toContain("runtime.lsp.invoke");
    expect(editorAdapter).not.toContain("runtime.lsp.commands()");
    expect(editorAdapter).not.toContain("__termco.invoke");

    const editorExtensions = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/editor-surface-native/src/editor/lib/extensions.ts",
      ),
      "utf8",
    );
    expect(editorExtensions).toContain("linter(null)");

    const lspE2e = await fs.readFile(join(root, "e2e/lsp.spec.ts"), "utf8");
    expect(lspE2e).toContain(
      "plugin-repository/plugins/lsp-native/src/__fixtures__/fake-lsp.mjs",
    );
    expect(lspE2e).not.toContain("electron/main/lsp/");

    for (const file of ["config.ts", "install.ts", "sessions.ts"]) {
      const source = await fs.readFile(
        join(root, "plugin-repository/plugins/lsp-native/src", file),
        "utf8",
      );
      expect(source).not.toMatch(/require\(["'](?:electron|chokidar)["']\)/);
    }
  });

  it("routes shared shell execution only through shell-native", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/shell")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      fs.stat(join(root, "src/modules/ai/lib/native/native.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("routes all SSH consumers through the single ssh-native provider", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/ssh")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(join(root, "src/modules/workspace/sshHosts.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/ssh-native/src/main.ts"),
      "utf8",
    );
    expect(provider).toContain('context.provide("ssh.client", capability)');
    expect(provider).toContain("async replacementImpact()");
    expect(provider).toContain("await disconnectAll()");
    expect(provider).toContain("shutdownForwards()");

    await expect(
      fs.stat(join(root, "src/modules/workspace")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const consumerProof = await fs.readFile(
      join(root, "e2e/ports-sidebar-plugin.spec.ts"),
      "utf8",
    );
    expect(consumerProof).toContain('consumerPluginId: "ports-sidebar"');
    expect(consumerProof).toContain('capability: "ssh.client"');
    expect(consumerProof).not.toMatch(/\.invoke\("ssh_(?:status|state_get)"/);
  });

  it("routes workspace and WSL behavior only through workspace-native", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/workspace")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/workspace-native/src/main.ts"),
      "utf8",
    );
    expect(provider).toContain(
      'context.provide("workspace.registry", capability)',
    );
    const implementation = await fs.readFile(
      join(root, "plugin-repository/plugins/workspace-native/src/workspace.ts"),
      "utf8",
    );
    expect(implementation).toContain(
      "for (const initial of [currentDir, home])",
    );
    expect(implementation).toContain("listWslDistros");
    expect(implementation).toContain("wslHome");

    await expect(
      fs.stat(join(root, "src/modules/ai/lib/native/native.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      fs.stat(join(root, "src/modules/workspace")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("routes product Git behavior only through git-native", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/git")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/git-native/src/main.ts"),
      "utf8",
    );
    expect(provider).toContain('context.provide("git.repository", capability)');

    const terminalWidget = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/terminal-surface-native/src/terminal/block/components/portal/GitStatusWidget.tsx",
      ),
      "utf8",
    );
    expect(terminalWidget).toContain("const git = terminalRuntime().git");
    expect(terminalWidget).toContain("git.resolveRepo");
    expect(terminalWidget).toContain("git.status");
    expect(terminalWidget).not.toContain("invoke(");
    for (const relative of [
      "src/modules/terminal/TerminalStack.tsx",
      "src/modules/terminal/components",
      "src/modules/terminal/block/components",
      "src/modules/terminal/lib/useGitBranch.ts",
    ]) {
      await expect(fs.stat(join(root, relative))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }

    await expect(
      fs.stat(join(root, "src/modules/ai/lib/native/native.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const consumerProof = await fs.readFile(
      join(root, "e2e/settings-shared-provider-replacement.spec.ts"),
      "utf8",
    );
    expect(consumerProof).toContain(
      'consumerPluginId: "source-control-sidebar"',
    );
    expect(consumerProof).toContain('capability: "git.repository"');
    expect(consumerProof).not.toContain('.invoke("git_panel_snapshot"');
  });

  it("routes product file behavior only through files-native", async () => {
    await expect(
      fs.stat(join(root, "electron/main/plugin-repository/plugins/fs")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/files-native/src/main.ts"),
      "utf8",
    );
    expect(provider).toContain(
      'context.provide("workspace.files", capability)',
    );
    expect(provider).toContain("context.effect(() => fsWatchCloseAll)");

    const editorAdapter = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/editor-surface-native/src/platform.ts",
      ),
      "utf8",
    );
    expect(editorAdapter).toContain("runtime.files.readFile");
    expect(editorAdapter).toContain("runtime.files.writeFile");
    expect(editorAdapter).not.toContain("__termco.invoke");

    const explorerRuntime = await fs.readFile(
      join(root, "plugin-repository/plugins/explorer-sidebar/src/runtime.ts"),
      "utf8",
    );
    expect(explorerRuntime).toContain("files: WorkspaceFilesCapability");
    expect(explorerRuntime).not.toContain("__termco.invoke");

    const terminalCompletion = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/terminal-surface-native/src/terminal/block/lib/pathComplete.ts",
      ),
      "utf8",
    );
    expect(terminalCompletion).toContain("terminalRuntime().files.readDir");
    expect(terminalCompletion).not.toContain("invoke(");
  });

  it("routes coding-agent UI only through coding-agent-native capabilities", async () => {
    await expect(
      fs.stat(
        join(root, "electron/main/plugin-repository/plugins/coding-agent"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const uiClient = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/coding-agent-native/ui/lib/client.ts",
      ),
      "utf8",
    );
    expect(uiClient).toContain("codingAgentUiRuntime().agents.invoke");
    expect(uiClient).not.toMatch(/@\/native|__termco|bridge\(\)/);

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/coding-agent-native/src/main.ts"),
      "utf8",
    );
    expect(provider).toContain(
      'ctx.provide("agents.coding-sessions", capability)',
    );
    expect(provider).toContain("replacementImpact()");
    expect(provider).toContain("killAllCodingAgents()");
  });

  it("mounts source-owned tab surfaces without a legacy host bridge", async () => {
    await Promise.all(
      [
        "src/core/services/legacySurfaceHost.ts",
        "src/core/workspace/SurfaceHost.tsx",
        "src/core/workspace/SurfaceHost.test.tsx",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const surfaceHost = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/components/SurfaceHost.tsx",
      ),
      "utf8",
    );
    const workspaceRenderer = await fs.readFile(
      join(root, "core-plugins/workspace-shell-native/src/renderer.tsx"),
      "utf8",
    );
    const main = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(surfaceHost).toMatch(/UiTabKindContribution/);
    expect(workspaceRenderer).toContain("UiTabKindRegistry");
    expect(workspaceRenderer).toContain("tabKindRegistry.records");
    expect(main).not.toMatch(/tabKindsService|addKind\(/);
    await expect(
      fs.stat(
        join(
          root,
          "core-plugins/workspace-shell-native/src/workspace/hooks/useLegacyBridges.ts",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("owns shared agent activity in a selected source plugin", async () => {
    const owner = join(root, "plugin-repository/plugins/agent-activity-native");
    await Promise.all(
      ["src/activity.ts", "src/activity.test.ts", "src/renderer.tsx"].map(
        (relative) =>
          expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    const hooksManifest = JSON.parse(
      await fs.readFile(
        join(
          root,
          "plugin-repository/plugins/agent-hooks-native/termco-plugin.json",
        ),
        "utf8",
      ),
    ) as {
      activation: string;
    };
    expect(hooksManifest.activation).toBe("eager");
    await expect(
      fs.stat(
        join(
          root,
          "plugin-repository/plugins/agent-hooks-native/src/renderer.ts",
        ),
      ),
    ).resolves.toBeTruthy();
    const workspaceManifest = JSON.parse(
      await fs.readFile(
        join(root, "core-plugins/workspace-shell-native/termco-plugin.json"),
        "utf8",
      ),
    ) as { transitionalHostImports?: string[] };
    expect(workspaceManifest.transitionalHostImports ?? []).not.toContain(
      "@/modules/agents",
    );
    const localAgentRuntime = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-chat-native/src/baseline/runtime/localAgentNotifications.ts",
      ),
      "utf8",
    );
    expect(localAgentRuntime).toMatch(/AgentActivityControlCapability/);
    expect(localAgentRuntime).not.toMatch(/zustand|useAgentStore/);
    const header = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/header-native/src/AgentAwareHeader.tsx",
      ),
      "utf8",
    );
    expect(header).toContain("AgentActivityCapability");
    expect(header).not.toMatch(/modules\/agents|useAgentStore/);
  });

  it("does not retain dead legacy pane, handle-map, or system-info wrappers", async () => {
    await Promise.all(
      [
        "core-plugins/workspace-shell-native/src/workspace/hooks/usePaneHandlers.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/usePaneHandlers.test.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useSystemInfo.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useSystemInfo.test.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useActivePaneSync.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useActivePaneSync.test.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useLeafHandlePruning.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/useLeafHandlePruning.test.ts",
        "core-plugins/workspace-shell-native/src/workspace/hooks/usePaneHandleMaps.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const registry = await fs.readFile(
      join(root, "src/core/runtime/registry.ts"),
      "utf8",
    );
    expect(registry).not.toMatch(
      /usePaneHandlers|useSystemInfo|useActivePaneSync|useLeafHandlePruning|usePaneHandleMaps/,
    );
    const fileActions = await fs.readFile(
      join(
        root,
        "core-plugins/workspace-shell-native/src/workspace/hooks/useTabFileActions.ts",
      ),
      "utf8",
    );
    expect(fileActions).toMatch(/newTab|newPrivateTab|newBlockTab/);
    expect(fileActions).not.toMatch(
      /TerminalPaneHandle|terminalRefs|setTimeout/,
    );
    const terminalSessions = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/terminal-surface-native/src/sessions.ts",
      ),
      "utf8",
    );
    expect(terminalSessions).toContain("disposeSession(leafId)");
    expect(terminalSessions).toContain("open(input = {})");
    expect(terminalSessions).toContain("tabsProvider.transition(");
    await expect(
      fs.stat(join(root, "src/core/services/legacyActions.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(
        join(
          root,
          "core-plugins/workspace-shell-native/src/workspace/hooks/useLegacyBridges.ts",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(registry).not.toContain("legacyActions");
    const pluginTsconfig = await fs.readFile(
      join(root, "tsconfig.plugins.json"),
      "utf8",
    );
    expect(pluginTsconfig).not.toContain("legacyActions");
    const workspaceManifest = JSON.parse(
      await fs.readFile(
        join(root, "core-plugins/workspace-shell-native/termco-plugin.json"),
        "utf8",
      ),
    );
    expect(workspaceManifest.transitionalHostImports ?? []).not.toContain(
      "@/core/services/legacyActions",
    );
    const previewTabs = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/preview-surface-native/src/tabs.ts",
      ),
      "utf8",
    );
    expect(previewTabs).toContain("WorkspaceTabsCapability");
    expect(previewTabs).toContain("tabs.transition(");
    expect(previewTabs).not.toMatch(/UiTabsRuntime|getLegacyActions/);
    const containerIntegrations = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/containers-native/ui/lib/integrations.ts",
      ),
      "utf8",
    );
    expect(containerIntegrations).toContain("WorkspaceTabsCapability");
    expect(containerIntegrations).toContain("workspaceTabs.transition(");
    expect(containerIntegrations).not.toMatch(/UiTabsRuntime|getLegacyActions/);
    const editorNavigation = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/editor-surface-native/src/newFile.ts",
      ),
      "utf8",
    );
    expect(editorNavigation).toContain("WorkspaceTabsCapability");
    expect(editorNavigation).toContain("workspaceTabs.transition(");
    expect(editorNavigation).toContain("setLanguage(id, language)");
    const markdownSurface = await fs.readFile(
      join(root, "plugin-repository/plugins/markdown-surface/src/renderer.tsx"),
      "utf8",
    );
    expect(markdownSurface).toContain("MarkdownNavigationCapability");
    expect(markdownSurface).toContain("tabs.transition(");
    await Promise.all(
      [
        "src/core/services/legacySidebarHost.ts",
        "src/core/services/legacyHeaderHost.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    await expect(
      fs.stat(join(root, "src/core/services")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the exact complete status-bar UI in statusbar-native", async () => {
    const owner = join(root, "plugin-repository/plugins/statusbar-native");
    await Promise.all(
      [
        "src/renderer.tsx",
        "src/ExactStatusBar.tsx",
        "src/ExactStatusBar.test.tsx",
        "src/components/BreadcrumbSegment.tsx",
        "src/components/CollapsedSegments.tsx",
        "src/components/CurrentSegmentDropdown.tsx",
        "src/components/CwdBreadcrumb.tsx",
        "src/components/LspStatusPill.tsx",
        "src/components/WorkspaceEnvSelector.tsx",
        "src/items/AgentStatusItem.tsx",
        "src/items/AiOpenItem.tsx",
        "src/items/PrivatePill.tsx",
        "src/items/ReadyDot.tsx",
        "src/lib/pathUtils.ts",
        "src/lib/pathUtils.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    await Promise.all(
      [
        "src/plugin-repository/plugins/statusbar",
        "core-plugins/workspace-shell-native/src/workspace/components/InputModeToggle.tsx",
        "core-plugins/workspace-shell-native/src/workspace/components/OsIcon.tsx",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const renderer = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    const exactBar = await fs.readFile(
      join(owner, "src/ExactStatusBar.tsx"),
      "utf8",
    );
    const shell = await fs.readFile(
      join(root, "core-plugins/ui-shell-native/src/shell.ts"),
      "utf8",
    );
    expect(renderer).toContain('side: "root"');
    expect(renderer).not.toMatch(/style=|▣|●|◉|◌/);
    expect(exactBar).toContain(
      "termco-chrome flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border/70 px-3 font-mono text-xs text-muted-foreground",
    );
    expect(shell).toContain('renderSide("root")');

    const sourceFiles = await fs.readdir(join(owner, "src"), {
      recursive: true,
    });
    const sourceText = await Promise.all(
      sourceFiles
        .filter((relative) => /\.(?:ts|tsx)$/.test(relative))
        .map((relative) => fs.readFile(join(owner, "src", relative), "utf8")),
    );
    expect(sourceText.join("\n")).not.toMatch(
      /from\s+["'](?:@\/|@termco\/app|(?:\.\.\/)+\.\.\/src\/)/,
    );
  });

  it("keeps the exact Search in files UI in search-sidebar", async () => {
    const owner = join(root, "plugin-repository/plugins/search-sidebar");
    await Promise.all(
      ["src/renderer.tsx", "src/renderer.test.tsx", "src/search.ts"].map(
        (relative) =>
          expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    await expect(
      fs.stat(join(root, "src/modules/sidebar/components/SearchPanel.tsx")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const renderer = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    expect(renderer).toContain(
      "flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-2",
    );
    expect(renderer).toContain("Search01Icon");
    expect(renderer).not.toMatch(/style=|const muted/);
    expect(renderer).not.toMatch(/from\s+["'](?:@\/|@termco\/app)/);
  });

  it("keeps workspace tab orchestration inside the source-owning plugin", async () => {
    const owner = join(root, "core-plugins/workspace-shell-native");
    const manifest = JSON.parse(
      await fs.readFile(join(owner, "termco-plugin.json"), "utf8"),
    ) as { transitionalHostImports?: string[] };
    expect(manifest.transitionalHostImports ?? []).toEqual([]);

    await Promise.all(
      [
        "src/workspace/tabs/index.ts",
        "src/workspace/tabs/lib/useTabs/hook.ts",
        "src/workspace/tabs/lib/useTabs/hook.test.tsx",
        "src/workspace/tabs/lib/useTabs/tabTypes.ts",
        "src/workspace/tabs/lib/resolveAgentTab.ts",
        "src/workspace/tabs/lib/useWorkspaceCwd.ts",
        "src/workspace/tabs/lib/panes/ops.ts",
        "src/workspace/tabs/lib/panes/ops.test.ts",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );

    const sourceFiles = await fs.readdir(join(owner, "src"), {
      recursive: true,
    });
    const sourceText = await Promise.all(
      sourceFiles
        .filter((relative) => /\.(?:ts|tsx)$/.test(relative))
        .map((relative) => fs.readFile(join(owner, "src", relative), "utf8")),
    );
    expect(sourceText.join("\n")).not.toMatch(
      /@\/modules\/(?:tabs|terminal)|@\/platform\/workspaceTabsAccess/,
    );

    const tabsAdapter = await fs.readFile(
      join(owner, "src/workspace/tabs/lib/useTabs/hook.ts"),
      "utf8",
    );
    expect(tabsAdapter).toContain("WorkspaceTabsCapability");
    expect(tabsAdapter).toContain("TerminalSessionsCapability");
    expect(tabsAdapter).not.toMatch(/selectedWorkspaceTabs|disposeSession/);

    const appClose = await fs.readFile(
      join(owner, "src/workspace/hooks/useAppCloseGuard.ts"),
      "utf8",
    );
    const shortcuts = await fs.readFile(
      join(owner, "src/workspace/hooks/useAppShortcuts.ts"),
      "utf8",
    );
    expect(appClose).toContain("terminalSessions.hasForegroundProcesses()");
    expect(shortcuts).toContain("terminalSessions.clearFocused()");
    expect(shortcuts).toContain("terminalSessions.navigateFocusedBlocks(");
  });

  it("routes application storage only through the storage-json provider", async () => {
    await Promise.all(
      [
        "electron/main/plugin-repository/plugins/store",
        "resources/plugin-repository/plugins/store",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
  });

  it("keeps Ask User and Structured UI contracts exclusively in their AI-tool plugins", async () => {
    await Promise.all(
      [
        "plugin-repository/plugins/ai-chat-native/src/baseline/tools/askUser.ts",
        "plugin-repository/plugins/ai-chat-native/src/baseline/tools/ui/index.ts",
        "plugin-repository/plugins/ai-chat-native/src/baseline/tools/ui/showUi.ts",
        "plugin-repository/plugins/ai-chat-native/src/baseline/tools/ui/viewSpec.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const askOwner = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-tools-ask-user-native/src/tools.ts",
      ),
      "utf8",
    );
    expect(askOwner).toContain("inputSchema:");
    expect(askOwner).toContain("description:");
    expect(askOwner).toContain("parseAskUserInput");
    expect(askOwner).toContain("parseAskUserOutput");
    expect(askOwner).toContain("presentations:");

    const uiOwner = await fs.readFile(
      join(root, "plugin-repository/plugins/ai-tools-ui-native/src/tools.ts"),
      "utf8",
    );
    const uiSchema = await fs.readFile(
      join(root, "plugin-repository/plugins/ai-tools-ui-native/src/schema.ts"),
      "utf8",
    );
    const uiPresentation = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-tools-ui-native/src/presentation.ts",
      ),
      "utf8",
    );
    expect(uiOwner).toContain("showUiInputSchema");
    expect(uiOwner).toContain("askUiInputSchema");
    expect(uiOwner).toContain("presentations:");
    expect(uiSchema).toContain("export const viewSchema");
    expect(uiPresentation).toContain("parseShowUiInput");
    expect(uiPresentation).toContain("parseAskUiInput");
    expect(uiPresentation).toContain("parseAskUiOutput");

    const chatReaders = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-chat-native/src/baseline/components/AiRichUi/richUiData.ts",
      ),
      "utf8",
    );
    const chatRouting = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/ai-chat-native/src/baseline/components/AiChat/toolParts.tsx",
      ),
      "utf8",
    );
    const autoSend = await fs.readFile(
      join(root, "plugin-repository/plugins/ai-chat-native/src/autoSend.ts"),
      "utf8",
    );
    expect(chatReaders).toContain("toolsService.presentation(toolName)");
    expect(chatReaders).not.toMatch(/zod|viewSpecSchema|uiActionSchema/);
    expect(chatRouting).toContain('presentation?.renderer === "ask-user"');
    expect(chatRouting).toContain('presentation?.renderer === "structured-ui"');
    expect(autoSend).toContain("toolsService.presentation(getToolName(part))");
    expect(autoSend).not.toMatch(/ASK_USER_TOOL_NAME|ASK_UI_TOOL_NAME/);
  });

  it("keeps model execution only in ai-inference-native", async () => {
    await expectAbsent([
      "src/modules/ai/lib/agent/buildModel.ts",
      "src/modules/ai/lib/agent/configuredModel.ts",
      "src/modules/ai/lib/agent/runStream.ts",
    ]);
    const inference = await pluginSource(
      "ai-inference-native",
      "src/inference.ts",
    );
    expect(inference).toContain("generateText({");
    expect(inference).toContain("streamText({");
    expect(inference).toContain("adaptInferenceTools");
  });

  it("keeps speech transcription only in ai-speech-native", async () => {
    await expectAbsent([
      "src/modules/ai/config/stt.ts",
      "src/modules/ai/lib/stt/backends.ts",
      "src/modules/ai/lib/stt/transcribe.ts",
      "src/modules/ai/lib/stt/wav.ts",
    ]);
    const speech = await pluginSource("ai-speech-native", "src/speech.ts");
    expect(speech).toContain("createSpeechCapability");
    expect(speech).toContain("OPENAI_URL");
    expect(speech).toContain("GROQ_URL");
  });

  it("keeps browser AI tools and origin policy only in ai-tools-browser-native", async () => {
    await expectAbsent([
      "src/modules/ai/tools/browser.ts",
      "src/modules/ai/tools/approvalPolicy.ts",
    ]);
    const tools = await pluginSource("ai-tools-browser-native", "src/tools.ts");
    expect(tools).toContain("export class BrowserToolSet");
    expect(tools).toContain("originNeedsApproval");
    expect(tools).toContain("browser_ai_snapshot");
  });

  it("keeps container and port-forward AI tools only in ai-tools-containers-native", async () => {
    await expectAbsent([
      "src/modules/ai/tools/containers",
      "src/modules/ai/tools/ports",
    ]);
    const tools = await pluginSource(
      "ai-tools-containers-native",
      "src/tools.ts",
    );
    expect(tools).toContain("buildContainerTools");
    expect(tools).toContain("buildPortTools");
  });

  it("keeps managed coding-agent AI tools only in ai-tools-managed-agents-native", async () => {
    await expectAbsent([
      "src/modules/ai/tools/agent/helpers.ts",
      "src/modules/ai/tools/agent/index.ts",
    ]);
    const tools = await pluginSource(
      "ai-tools-managed-agents-native",
      "src/tools.ts",
    );
    for (const toolName of [
      "spawn_coding_agent",
      "send_to_agent",
      "read_agent_output",
    ]) {
      expect(tools).toContain(`${toolName}:`);
    }
    expect(tools).toContain("runtime.getManagedCodingAgent");
  });

  it("keeps MCP AI tool adaptation only in ai-tools-mcp-native", async () => {
    await expectAbsent([
      "src/modules/ai/tools/mcp.ts",
      "src/modules/ai/tools/mcpSurface.ts",
    ]);
    const tools = await pluginSource("ai-tools-mcp-native", "src/tools.ts");
    expect(tools).toContain("sanitizeToolName");
    expect(tools).toContain("normalizeMcpContent");
    expect(tools).toContain("buildMcpTools");
  });

  it("keeps skill activation semantics only in ai-tools-skill-native", async () => {
    await expectAbsent(["src/modules/ai/tools/skill.ts"]);
    const tools = await pluginSource("ai-tools-skill-native", "src/tools.ts");
    expect(tools).toContain("createSkillContribution");
    expect(tools).toContain("allowedGroups: skill.allowedGroups");
    expect(tools).toContain("deactivated: true");
  });

  it("keeps subagent definitions and orchestration only in ai-tools-subagents-native", async () => {
    await expectAbsent(["src/modules/ai/tools/subagent.ts"]);
    const registry = await pluginSource(
      "ai-tools-subagents-native",
      "src/registry.ts",
    );
    const tools = await pluginSource(
      "ai-tools-subagents-native",
      "src/tools.ts",
    );
    expect(registry).toContain("SUBAGENTS");
    expect(tools).toContain("run_subagent:");
    expect(tools).toContain("input.inference.generate");
  });

  it("keeps system AI actions only in ai-tools-system-native", async () => {
    await expectAbsent(["src/modules/ai/tools/system"]);
    const tools = await pluginSource("ai-tools-system-native", "src/tools.ts");
    for (const toolName of [
      "notify_user",
      "read_clipboard",
      "write_clipboard",
      "command_history",
      "reveal_in_os",
    ]) {
      expect(tools).toContain(`${toolName}:`);
    }
  });

  it("keeps session task-list validation only in ai-tools-todo-native", async () => {
    await expectAbsent(["src/modules/ai/tools/todo.ts"]);
    const tools = await pluginSource("ai-tools-todo-native", "src/tools.ts");
    expect(tools).toContain("todo_write: definition");
    expect(tools).toContain('enum: ["pending", "in_progress", "completed"]');
    expect(tools).toContain("runtime.replaceTodos");
  });

  it("keeps context-recall AI tools only in ai-tools-transcript-native", async () => {
    await expectAbsent(["src/modules/ai/tools/transcript.ts"]);
    const tools = await pluginSource(
      "ai-tools-transcript-native",
      "src/tools.ts",
    );
    expect(tools).toContain("read_transcript: readTranscript");
    expect(tools).toContain("read_tool_output: readToolOutput");
    expect(tools).toContain("artifacts.readTranscript");
    expect(tools).toContain("artifacts.readToolOutput");
  });

  it("keeps workflow AI actions and command defenses only in ai-tools-workflows-native", async () => {
    await expectAbsent(["src/modules/ai/tools/workflows.ts"]);
    const tools = await pluginSource(
      "ai-tools-workflows-native",
      "src/tools.ts",
    );
    const security = await pluginSource(
      "ai-tools-workflows-native",
      "src/security.ts",
    );
    expect(tools).toContain("list_workflows:");
    expect(tools).toContain("run_workflow:");
    expect(tools).toContain("save_workflow:");
    expect(security).toContain("checkShellCommand");
    expect(security).toMatch(/rm\s+-rf|filesystem root/);
  });

  it("keeps provider and model metadata only in models-native", async () => {
    await expectAbsent([
      "src/modules/ai/config/autocomplete.ts",
      "src/modules/ai/config/base-urls.ts",
      "src/modules/ai/config/endpoints.ts",
      "src/modules/ai/config/models.ts",
      "src/modules/ai/config/pricing.ts",
      "src/modules/ai/config/providers.ts",
      "src/modules/ai/config/reasoning.ts",
    ]);
    const renderer = await pluginSource("models-native", "src/renderer.ts");
    expect(renderer).toContain("MODEL_PROVIDERS");
    expect(renderer).toContain("context.provide(AI_MODELS_SERVICE, registry)");
    expect(renderer).toContain("registry.register(provider)");
    await Promise.all(
      [
        "models.ts",
        "providers.ts",
        "pricing.ts",
        "reasoning.ts",
        "endpoints.ts",
      ].map((relative) =>
        expect(
          fs.stat(
            join(root, "plugin-repository/plugins/models-native/src", relative),
          ),
        ).resolves.toBeTruthy(),
      ),
    );
  });

  it("keeps the complete plugin catalogue workflow only in plugin-manager-native", async () => {
    await expectAbsent([
      "src/plugin-repository/plugins/plugin-manager",
      "src/core/plugin-host",
    ]);
    const renderer = await pluginSource(
      "plugin-manager-native",
      "src/renderer.tsx",
    );
    const catalog = await pluginSource(
      "plugin-manager-native",
      "src/catalog.ts",
    );
    expect(renderer).toContain("profile.fork");
    expect(renderer).toContain("profile.apply");
    expect(renderer).toContain("profile.uninstall");
    expect(renderer).toContain("openPluginFolder");
    expect(catalog).toContain("matchesPlugin");
    expect(catalog).toContain("groupedCatalog");
  });

  it("does not retain the unreachable host AI implementation mirror", async () => {
    await Promise.all(
      [
        "src/modules/ai",
        "src/components/ai-elements",
        "src/native/store.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    await Promise.all(
      ["src/platform/modelRegistryAccess.ts", "src/lib/redactSensitive.ts"].map(
        (relative) =>
          expect(fs.stat(join(root, relative))).rejects.toMatchObject({
            code: "ENOENT",
          }),
      ),
    );
    await expect(
      fs.stat(
        join(
          root,
          "plugin-repository/plugins/terminal-surface-native/src/redactSensitive.ts",
        ),
      ),
    ).resolves.toBeTruthy();
    const rendererMain = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(rendererMain).not.toContain("modules/ai");
  });

  it("does not retain the obsolete AI sessions compatibility bridge", async () => {
    await Promise.all(
      ["src/platform/aiSessionsLegacyBridge.ts", "src/modules/editor"].map(
        (relative) =>
          expect(fs.stat(join(root, relative))).rejects.toMatchObject({
            code: "ENOENT",
          }),
      ),
    );
    await expect(
      fs.stat(join(root, "src/platform/sdk.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const chatPlugin = await fs.readFile(
      join(root, "plugin-repository/plugins/ai-chat-native/src/plugin.ts"),
      "utf8",
    );
    const chatStore = await fs.readFile(
      join(root, "plugin-repository/plugins/ai-chat-native/src/store/store.ts"),
      "utf8",
    );
    expect(chatPlugin).not.toContain("installAiSessionsLegacy");
    expect(chatStore).not.toContain("aiSessionsLegacyRuntime");

    const editor = await pluginSource(
      "editor-surface-native",
      "src/renderer.tsx",
    );
    const statusbar = await pluginSource(
      "statusbar-native",
      "src/renderer.tsx",
    );
    expect(editor).toContain(
      'context.provide<EditorLspStatusCapability>("editor.lsp-status"',
    );
    expect(statusbar).toContain("EDITOR_LSP_STATUS_SERVICE");
    expect(statusbar).toContain("context.observe<EditorLspStatusCapability>(");
    expect(statusbar).toContain("optionalInject: [");
  });

  it("keeps header and status-bar runtime composition inside their source plugins", async () => {
    await Promise.all(
      [
        "src/platform/legacyHeaderAdapter.tsx",
        "src/platform/legacyStatusbarAdapter.tsx",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const rendererMain = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(rendererMain).not.toMatch(/useLegacy(?:Header|Statusbar)Runtime/);
    expect(rendererMain).toContain("renderRendererProfileRoot(root, profile)");
    const rendererRoot = await fs.readFile(
      join(root, "src/core/runtime/renderRendererProfileRoot.tsx"),
      "utf8",
    );
    expect(rendererRoot).toContain("<ShellRoot />");
    expect(rendererMain).not.toMatch(/\.Header|\.Statusbar/);
    const shellContract = await fs.readFile(
      join(root, "plugin-repository/plugins/ui-shell-base/src/index.ts"),
      "utf8",
    );
    expect(shellContract).toMatch(
      /interface UiShellCapability\s*\{\s*\/\*\*[\s\S]*?Root: ComponentType;\s*\}/,
    );

    for (const pluginId of ["header-native", "statusbar-native"] as const) {
      const owner = join(root, `plugin-repository/plugins/${pluginId}`);
      await expect(
        fs.stat(join(owner, "src/runtime.tsx")),
      ).resolves.toBeTruthy();
    }

    const shell = await fs.readFile(
      join(root, "core-plugins/ui-shell-native/src/shell.ts"),
      "utf8",
    );
    expect(shell).not.toMatch(/UiHeaderShellProps|UiStatusbarShellProps/);
    expect(shell).not.toMatch(/Component, \{ key: item\.id, runtime \}/);

    const managedRuntime = JSON.parse(
      await fs.readFile(
        join(
          root,
          "plugin-repository/plugins/managed-agent-runtime-native/termco-plugin.json",
        ),
        "utf8",
      ),
    ) as {
      activation: string;
    };
    expect(managedRuntime).toMatchObject({
      activation: "eager",
    });
    expect(rendererMain).not.toMatch(/modules\/agents|spawnManagedAgent/);
  });

  it("keeps command-palette orchestration inside command-palette-native", async () => {
    const owner = join(
      root,
      "plugin-repository/plugins/command-palette-native",
    );
    const renderer = await fs.readFile(join(owner, "src/renderer.tsx"), "utf8");
    for (const capabilityService of [
      "EDITOR_NAVIGATION_SERVICE",
      "TERMINAL_SESSIONS_SERVICE",
      "UI_SIDEBAR_NAVIGATION_SERVICE",
      "WORKSPACE_PRESENTATION_SERVICE",
      "WORKSPACE_RIGS_SERVICE",
      "WORKSPACE_TABS_SERVICE",
    ]) {
      expect(renderer).toContain(capabilityService);
    }
    expect(renderer).toContain("optionalInject: [");
    expect(renderer).toContain("context.observe<WorkspaceTabsCapability>(");
    expect(renderer).not.toContain("UiOverlayRuntime");
    expect(renderer).not.toContain("runtime.additionalCommands");
    expect(renderer).not.toContain("runtime.commandRuntime");

    const rendererMain = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(rendererMain).not.toContain("collectPaletteItems");
    expect(rendererMain).not.toContain("usePaletteSources");
  });

  it("keeps the renderer host as a minimal profile and module-loading kernel", async () => {
    expect(await fs.readdir(join(root, "src/core"))).toEqual(["runtime"]);
    await Promise.all(
      [
        "agentsViewAccess.tsx",
        "aiDockAccess.ts",
        "aiSessionsAccess.ts",
        "aiToolsAccess.ts",
        "browserPolicyAccess.ts",
        "codingAgentsUiAccess.ts",
        "commandPaletteAccess.ts",
        "modelRegistryAccess.ts",
        "rendererCapabilityAccess.ts",
        "settingsViewAccess.tsx",
        "sidebarNavigationAccess.ts",
        "workspaceEnvironmentAccess.ts",
        "workspacePresentationAccess.ts",
        "workspaceRigsAccess.ts",
        "workspaceTabActionsAccess.ts",
        "workspaceTabsAccess.ts",
      ].map((relative) =>
        expect(
          fs.stat(join(root, "src/platform", relative)),
        ).rejects.toMatchObject({ code: "ENOENT" }),
      ),
    );

    const rendererMain = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(rendererMain).toContain("installRuntimeModules()");
    expect(rendererMain).toContain("bootRendererPlugins()");
    expect(rendererMain).toContain("renderRendererProfileRoot(root, profile)");
    expect(rendererMain).not.toMatch(
      /CoreShell|useSlotStore|mountV2Contributions|UiOverlayRuntime|UiBackgroundRuntime/,
    );
  });

  it("owns selection-to-AI UI in a complete copyable leaf plugin", async () => {
    const owner = join(
      root,
      "plugin-repository/plugins/selection-ask-ai-native",
    );
    await Promise.all(
      [
        "src/SelectionAskAi.tsx",
        "src/SelectionAskAi.test.tsx",
        "src/useSelectionAskAi.ts",
        "src/useSelectionAskAi.test.ts",
        "src/selection.ts",
        "src/selection.test.ts",
        "termco-plugin.json",
      ].map((relative) =>
        expect(fs.stat(join(owner, relative))).resolves.toBeTruthy(),
      ),
    );
    await Promise.all(
      [
        "src/baseline/components/SelectionAskAi.tsx",
        "src/ui/useSelectionAskAi.ts",
      ].map((relative) =>
        expect(
          fs.stat(
            join(root, "plugin-repository/plugins/ai-chat-native", relative),
          ),
        ).rejects.toMatchObject({ code: "ENOENT" }),
      ),
    );
  });

  it("keeps local events in the kernel and cross-process bridging in events-native", async () => {
    await expect(
      fs.stat(join(root, "src/native/event.ts")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const implementation = await fs.readFile(
      join(root, "src/platform/runtime.ts"),
      "utf8",
    );
    expect(implementation).toContain(
      "new Map<string, Set<KernelEventListener>>()",
    );
    expect(implementation).toContain("new Set<KernelAnyEventListener>()");

    await expect(
      fs.stat(join(root, "electron/main/core/pluginEventBridge.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const projection = await fs.readFile(
      join(root, "plugin-repository/plugins/events-native/src/renderer.ts"),
      "utf8",
    );
    expect(projection).toContain("inject: [processTransportService]");
    expect(projection).toContain("connectRendererApplicationEvents");
    expect(projection).toContain(
      'transport.call(EVENTS_APPLICATION_BRIDGE_SERVICE, "subscribeAll"',
    );
    expect(projection).toContain("transport.releaseChannel(channel)");
    expect(projection).toContain("transport.releaseRemote(handle)");
  });

  it("keeps shell-history indexing only in history-native", async () => {
    await Promise.all(
      [
        "electron/main/history",
        "electron/main/plugin-repository/plugins/history",
        "src/modules/terminal/block/lib/history.ts",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );

    const provider = await fs.readFile(
      join(root, "plugin-repository/plugins/history-native/src/main.ts"),
      "utf8",
    );
    const state = await fs.readFile(
      join(root, "plugin-repository/plugins/history-native/src/state.ts"),
      "utf8",
    );
    expect(provider).toContain(
      'context.provide("terminal.history", capability)',
    );
    expect(provider).toContain(
      "context.get<WorkspaceExecutionCapability>(WORKSPACE_EXECUTION_SERVICE)",
    );
    expect(provider).toContain('domain: "history", method: "suggest"');
    expect(provider).not.toContain("SshClientCapability");
    expect(state).toContain("export class HistoryState");
    expect(state).toContain("async prewarm(): Promise<void>");
  });

  it("keeps MCP server ownership in mcp-server-native and rig projection in mcp-rig-sync", async () => {
    await Promise.all(
      [
        "electron/main/mcp-server",
        "electron/main/plugin-repository/plugins/mcp-server",
        "src/modules/coding-agents/lib/mcpServerClient.ts",
        "src/modules/coding-agents/lib/useMcpRigSync.ts",
        "src/plugin-repository/plugins/mcp-ui",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    await Promise.all(
      [
        "src/approvals.ts",
        "src/bridge.ts",
        "src/httpServer.ts",
        "src/protocol.ts",
        "src/rigRegistry.ts",
        "src/tokens.ts",
      ].map((relative) =>
        expect(
          fs.stat(
            join(root, "plugin-repository/plugins/mcp-server-native", relative),
          ),
        ).resolves.toBeTruthy(),
      ),
    );
    const server = await fs.readFile(
      join(root, "plugin-repository/plugins/mcp-server-native/src/main.ts"),
      "utf8",
    );
    expect(server).toContain('context.provide("mcp.server", capability)');
    expect(server).toContain("replacementImpact()");
    const sync = await fs.readFile(
      join(root, "plugin-repository/plugins/mcp-rig-sync/src/renderer.tsx"),
      "utf8",
    );
    expect(sync).toContain("server.syncRigs(rigs)");
    expect(sync).not.toMatch(
      /__termco|invoke\s*\(|electron\/main|mcp-server-native\/src/,
    );
  });

  it("keeps the theme-file edit workflow only in theme-file-editing", async () => {
    await Promise.all(
      [
        "src/modules/theme/hooks/useThemeFileEditing.ts",
        "src/modules/theme/lib/themeFiles.ts",
        "src/modules/theme/themeFiles.ts",
        "src/plugin-repository/plugins/theme-editing",
      ].map((relative) =>
        expect(fs.stat(join(root, relative))).rejects.toMatchObject({
          code: "ENOENT",
        }),
      ),
    );
    const workflow = await fs.readFile(
      join(
        root,
        "plugin-repository/plugins/theme-file-editing/src/renderer.tsx",
      ),
      "utf8",
    );
    expect(workflow).toContain('events.subscribe("fs:file-written"');
    expect(workflow).toContain('events.subscribe("termco://theme-edit"');
    expect(workflow).not.toMatch(/@\/modules|__termco\.invoke|src\/modules/);
  });

  it("treats safe recovery as a new profile feature with no legacy owner to delete", async () => {
    const profile = JSON.parse(
      await fs.readFile(
        join(root, "profiles/safe-recovery/profile.json"),
        "utf8",
      ),
    ) as {
      id: string;
      plugins: Array<{ id: string }>;
    };
    expect(profile).toMatchObject({
      id: "termco.safe-recovery",
    });
    expect(profile.plugins.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([
        "boot-diagnostics-native",
        "safe-recovery-native",
      ]),
    );

    const diagnostics = await fs.readFile(
      join(root, "core-plugins/boot-diagnostics-native/src/main.ts"),
      "utf8",
    );
    expect(diagnostics).toContain(
      'context.provide("application.boot-diagnostics", capability)',
    );
    const recovery = await fs.readFile(
      join(root, "core-plugins/safe-recovery-native/src/renderer.tsx"),
      "utf8",
    );
    expect(recovery).toContain("context.get<BootDiagnosticsCapability>(");
    expect(recovery).toContain("get<UiOverlayRegistry>(UI_OVERLAYS_SERVICE)");
    expect(recovery).toContain(".register(");

    expect(diagnostics).toContain(
      'const STORE_PATH = "termco-boot-diagnostics.json"',
    );
    expect(diagnostics).toContain(
      'const DIAGNOSTIC_KEY = "lastProfileBootFailure"',
    );
  });

  it("treats company examples as new profile additions, not legacy migrations", async () => {
    const company = JSON.parse(
      await fs.readFile(
        join(root, "profiles/company-example/profile.json"),
        "utf8",
      ),
    ) as {
      id: string;
      plugins: Array<{ id: string }>;
    };
    const defaultProfile = JSON.parse(
      await fs.readFile(join(root, "profiles/default/profile.json"), "utf8"),
    ) as { plugins: Array<{ id: string }> };
    const exampleIds = [
      "company-example-command",
      "company-example-http",
      "company-example-statusbar",
    ];
    expect(company).toMatchObject({
      id: "company.example",
    });
    expect(company.plugins.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(exampleIds),
    );
    expect(defaultProfile.plugins.map((entry) => entry.id)).not.toEqual(
      expect.arrayContaining(exampleIds),
    );

    const http = JSON.parse(
      await fs.readFile(
        join(
          root,
          "plugin-repository/plugins/company-example-http/termco-plugin.json",
        ),
        "utf8",
      ),
    ) as { replaces?: string };
    const statusbar = JSON.parse(
      await fs.readFile(
        join(
          root,
          "plugin-repository/plugins/company-example-statusbar/termco-plugin.json",
        ),
        "utf8",
      ),
    ) as { replaces?: string };
    expect(http.replaces).toBe("http-native");
    expect(statusbar.replaces).toBe("statusbar-native");
  });

  it("keeps renderer product source exclusively inside copyable plugins", async () => {
    await expect(fs.stat(join(root, "src/modules"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const rendererMain = await fs.readFile(join(root, "src/main.tsx"), "utf8");
    expect(rendererMain).not.toMatch(/@\/modules|\.\/modules/);
    const pluginTypes = await fs.readFile(
      join(root, "tsconfig.plugins.json"),
      "utf8",
    );
    expect(pluginTypes).not.toMatch(/src\/modules|@\/modules/);
  });
});

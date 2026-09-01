import { describe, expect, it } from "vitest";
import commandPaletteNative from "../../plugin-repository/plugins/command-palette-native/src/renderer";
import gitSurface from "../../plugin-repository/plugins/git-surface/src/renderer";
import headerNative from "../../plugin-repository/plugins/header-native/src/renderer";
import rigsCommands from "../../plugin-repository/plugins/rigs-commands/src/renderer";
import sourceControlSidebar from "../../plugin-repository/plugins/source-control-sidebar/src/renderer";
import statusbarNative from "../../plugin-repository/plugins/statusbar-native/src/renderer";
import workspaceShellNative from "../../core-plugins/workspace-shell-native/src/renderer";
import type { TermcoPluginManifestV3, TermcoProfileV3 } from "./contracts";
import { resolvePluginTree } from "./resolve";
import { CapabilityRuntime, type PluginModule } from "./runtime";

interface RegistryFixture {
  readonly value: object;
  readonly size: () => number;
}

function registryFixture(): RegistryFixture {
  const entries = new Set<unknown>();
  const value = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "register") {
          return (entry: unknown) => {
            entries.add(entry);
            return () => entries.delete(entry);
          };
        }
        if (property === "snapshot") return () => [...entries];
        if (property === "subscribe") return () => () => {};
        return () => undefined;
      },
    },
  );
  return { value, size: () => entries.size };
}

function manifest(id: string): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: id,
    description: id,
    category: "Test",
    version: "1.0.0",
    entrypoints: { renderer: "src/renderer.ts" },
    dependencies: {},
  };
}

function runtimeFor(id: string, additionalIds: readonly string[] = []): CapabilityRuntime {
  const manifests = [id, ...additionalIds].map(manifest);
  const profile: TermcoProfileV3 = {
    schemaVersion: 3,
    id: "test.profile",
    bundles: [],
    plugins: manifests.map((plugin) => ({ id: plugin.id, module: `./${plugin.id}` })),
    patches: [],
  };
  return new CapabilityRuntime(
    resolvePluginTree({
      profile,
      manifests: new Map(manifests.map((plugin) => [plugin.id, plugin])),
    }),
  );
}

const subjects: ReadonlyArray<{
  id: string;
  module: PluginModule;
  hard: readonly string[];
}> = [
  {
    id: "command-palette-native",
    module: commandPaletteNative,
    hard: ["ui.command-palette", "ui.commands", "ui.overlays"],
  },
  {
    id: "statusbar-native",
    module: statusbarNative,
    hard: ["ui.statusbar.items"],
  },
  {
    id: "header-native",
    module: headerNative,
    hard: ["ui.header.items"],
  },
  {
    id: "workspace-shell-native",
    module: workspaceShellNative,
    hard: [
      "ui.sidebar.views",
      "ui.tabs.kinds",
      "ui.workspace.views",
      "ui.commands",
    ],
  },
];

describe("optional UI host dependencies", () => {
  for (const subject of subjects) {
    it(`${subject.id} stays active without leaf providers and cleans up only on its own deactivation`, async () => {
      expect(subject.module.inject).toEqual(subject.hard);
      expect(subject.module.optionalInject?.length).toBeGreaterThan(0);

      const runtime = runtimeFor(subject.id);
      const fixtures = new Map<string, RegistryFixture>();
      for (const service of subject.hard) {
        const fixture = registryFixture();
        fixtures.set(service, fixture);
        runtime.installExternalCapability(service, `kernel:${service}`, fixture.value);
      }

      await runtime.activate(subject.id, subject.module);
      expect(runtime.inspect()).toContainEqual({
        pluginId: subject.id,
        state: "active",
      });
      expect([...fixtures.values()].some((fixture) => fixture.size() > 0)).toBe(
        true,
      );

      const optionalService = subject.module.optionalInject?.[0];
      expect(optionalService).toBeTruthy();
      const removeOptional = runtime.installExternalCapability(
        optionalService!,
        `leaf:${optionalService}`,
        registryFixture().value,
      );
      await removeOptional();
      expect(runtime.inspect()).toContainEqual({
        pluginId: subject.id,
        state: "active",
      });
      expect([...fixtures.values()].some((fixture) => fixture.size() > 0)).toBe(
        true,
      );

      await runtime.deactivate(subject.id);
      expect([...fixtures.values()].every((fixture) => fixture.size() === 0)).toBe(
        true,
      );
    });
  }

  for (const subject of [
    {
      id: "source-control-sidebar",
      module: sourceControlSidebar,
      hard: ["workspace.tabs", "ui.sidebar.views", "ui.commands"],
      expectedContributions: 3,
    },
    {
      id: "git-surface",
      module: gitSurface,
      hard: ["ui.tabs.kinds"],
      expectedContributions: 2,
    },
  ]) {
    it(`${subject.id} removes only its Git-owned child feature when Git disappears`, async () => {
      expect(subject.module.inject).toEqual(subject.hard);
      expect(subject.module.optionalInject).toContain("git.repository");
      const runtime = runtimeFor(subject.id, ["git-provider"]);
      const fixtures: RegistryFixture[] = [];
      for (const service of subject.hard) {
        const fixture = registryFixture();
        fixtures.push(fixture);
        runtime.installExternalCapability(service, `kernel:${service}`, fixture.value);
      }

      await runtime.activate(subject.id, subject.module);
      expect(runtime.inspect()).toContainEqual({ pluginId: subject.id, state: "active" });
      expect(fixtures.reduce((total, fixture) => total + fixture.size(), 0)).toBe(0);

      await runtime.activate("git-provider", {
        activate: (context) => context.provide("git.repository", {}),
      });
      expect(fixtures.reduce((total, fixture) => total + fixture.size(), 0)).toBe(
        subject.expectedContributions,
      );

      await runtime.deactivate("git-provider");
      expect(fixtures.reduce((total, fixture) => total + fixture.size(), 0)).toBe(0);
      expect(runtime.inspect()).toContainEqual({ pluginId: subject.id, state: "active" });
      expect(runtime.inspectFeatures()).toContainEqual(
        expect.objectContaining({
          pluginId: subject.id,
          state: "pending",
          missingServices: ["git.repository"],
        }),
      );
    });
  }

  it("keeps rig navigation while only the rig-workflow feature disappears", async () => {
    const runtime = runtimeFor("rigs-commands", [
      "rig-store",
      "rig-overview",
      "rig-workflows",
    ]);
    const commands = new Map<string, unknown>();
    runtime.installExternalCapability("ui.commands", "ui-shell", {
      register(command: { id: string }) {
        commands.set(command.id, command);
        return () => commands.delete(command.id);
      },
    });
    await runtime.activate("rigs-commands", rigsCommands);

    await runtime.activate("rig-store", {
      activate: (context) =>
        context.provide("workspace.rigs", {
          snapshot: () => ({ rigs: [], activeId: null }),
          subscribe: () => () => {},
        }),
    });
    await runtime.activate("rig-overview", {
      activate: (context) =>
        context.provide("workspace.rigs-overview", { setOpen: () => {} }),
    });
    await runtime.activate("rig-workflows", {
      activate: (context) =>
        context.provide("workspace.rig-workflows", { createLocal: () => {} }),
    });
    expect([...commands.keys()]).toEqual(["rigs", "rigs.new"]);

    await runtime.deactivate("rig-workflows");
    expect([...commands.keys()]).toEqual(["rigs"]);
    expect(runtime.inspect()).toContainEqual({
      pluginId: "rigs-commands",
      state: "active",
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { ResolvedPluginTree, TermcoPluginManifestV3 } from "./contracts";
import type {
  RendererBootstrapData,
  RendererPluginModuleDescriptor,
  RendererProfileChange,
} from "./rendererBootstrap";
import {
  bootRendererPlugins,
  currentRendererProfile,
  disposeRendererPlugins,
  quiesceRendererPlugins,
  replaceRendererPlugins,
  subscribeRendererProfile,
} from "./rendererRuntime";

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

function moduleUrl(
  id: string,
  generation: string,
  options: { inject?: string; provide?: string } = {},
): string {
  const source = `
    export default {
      ${options.inject ? `inject: [${JSON.stringify(options.inject)}],` : ""}
      activate(context) {
        globalThis.__rendererTransactionEvents.push(${JSON.stringify(`activate:${id}:${generation}`)});
        ${options.provide ? `context.provide(${JSON.stringify(options.provide)}, { generation: ${JSON.stringify(generation)} });` : ""}
        return () => globalThis.__rendererTransactionEvents.push(${JSON.stringify(`dispose:${id}:${generation}`)});
      }
    };
  `;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function data(generation: string): RendererBootstrapData {
  const manifests = [
    manifest("stable-renderer"),
    manifest("pty-renderer"),
    manifest("terminal-consumer"),
  ];
  const tree: ResolvedPluginTree = {
    profileId: `profile-${generation}`,
    plugins: manifests.map((entry) => ({
      id: entry.id,
      manifest: entry,
      source: {
        type: "local",
        module: entry.id,
        location: entry.id,
        integrity:
          entry.id === "pty-renderer" ? `${entry.id}-${generation}` : entry.id,
      },
    })),
    activationOrder: manifests.map((entry) => entry.id),
  };
  const modules: RendererPluginModuleDescriptor[] = [
    {
      pluginId: "stable-renderer",
      version: "1.0.0",
      integrity: "stable",
      url: moduleUrl("stable-renderer", "stable", {
        provide: "company.stable",
      }),
    },
    {
      pluginId: "pty-renderer",
      version: "1.0.0",
      integrity: generation,
      url: moduleUrl("pty-renderer", generation, {
        inject: "kernel.process-transport",
        provide: "terminal.pty",
      }),
    },
    {
      pluginId: "terminal-consumer",
      version: "1.0.0",
      integrity: generation,
      url: moduleUrl("terminal-consumer", generation, {
        inject: "terminal.pty",
      }),
    },
  ];
  return {
    generation: `renderer-${generation}`,
    profileId: tree.profileId,
    plugins: tree.plugins,
    activationOrder: tree.activationOrder,
    modules,
    catalog: [],
  };
}

function remoteModuleUrl(
  codeGeneration: string,
  options: { fail?: boolean } = {},
): string {
  const source = `
    export default {
      inject: ["kernel.process-transport"],
      async activate(context) {
        const transport = context.get("kernel.process-transport");
        await transport.call("company.remote", "activate", [${JSON.stringify(codeGeneration)}]);
        ${options.fail ? 'throw new Error("candidate renderer failed");' : ""}
        context.provide("company.remote-bridge", { generation: ${JSON.stringify(codeGeneration)} });
        return async () => {
          globalThis.__rendererTransactionEvents.push(${JSON.stringify(`dispose:remote-renderer:${codeGeneration}`)});
          await transport.call("company.remote", "cleanup", [${JSON.stringify(codeGeneration)}]);
        };
      }
    };
  `;
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function remoteData(
  transportGeneration: string,
  codeGeneration: string,
  options: { fail?: boolean } = {},
): RendererBootstrapData {
  const entry = manifest("remote-renderer");
  const tree: ResolvedPluginTree = {
    profileId: `remote-${codeGeneration}`,
    plugins: [
      {
        id: entry.id,
        manifest: entry,
        source: {
          type: "local",
          module: entry.id,
          location: entry.id,
          integrity: codeGeneration,
        },
      },
    ],
    activationOrder: [entry.id],
  };
  return {
    generation: transportGeneration,
    profileId: tree.profileId,
    plugins: tree.plugins,
    activationOrder: tree.activationOrder,
    modules: [
      {
        pluginId: entry.id,
        version: "1.0.0",
        integrity: codeGeneration,
        url: remoteModuleUrl(codeGeneration, options),
      },
    ],
    catalog: [],
  };
}

declare global {
  var __rendererTransactionEvents: string[];
}

afterEach(async () => {
  await disposeRendererPlugins();
  delete (globalThis as { __termco?: unknown }).__termco;
  delete (globalThis as { __rendererTransactionEvents?: unknown })
    .__rendererTransactionEvents;
});

describe("renderer replacement transaction", () => {
  it("can cold-activate a recovery profile after the selected renderer fails to boot", async () => {
    const broken = remoteData("renderer-broken", "broken", { fail: true });
    const recovery = remoteData("renderer-recovery", "recovery");
    let replaceFromMain:
      | ((change: RendererProfileChange) => Promise<{
          ok: boolean;
          generation: string;
          error?: string;
        }>)
      | undefined;
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => broken,
      onRendererPluginProfileChanged: (callback: typeof replaceFromMain) => {
        replaceFromMain = callback;
        return () => {};
      },
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await expect(bootRendererPlugins()).rejects.toThrow(
      "candidate renderer failed",
    );
    expect(replaceFromMain).toBeDefined();

    await expect(
      replaceFromMain?.({
        phase: "quiesce",
        profile: recovery,
        changedPluginIds: ["remote-renderer"],
        changedServiceNames: [],
      }),
    ).resolves.toEqual({
      ok: true,
      generation: recovery.generation,
    });
    await expect(
      replaceFromMain?.({
        phase: "activate",
        profile: recovery,
        changedServiceNames: [],
      }),
    ).resolves.toEqual({
      ok: true,
      generation: recovery.generation,
    });

    expect(currentRendererProfile()?.tree.profileId).toBe(recovery.profileId);
  });

  it("can reactivate a plugin after a no-op activation of the quiesced graph", async () => {
    const selected = remoteData("renderer-G0", "v1");
    const quiesced: RendererBootstrapData = {
      ...selected,
      generation: "renderer-G1",
      plugins: [],
      activationOrder: [],
      modules: [],
    };
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => selected,
      onRendererPluginProfileChanged: () => () => {},
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    await quiesceRendererPlugins(quiesced, ["remote-renderer"]);
    await replaceRendererPlugins(quiesced);
    await expect(
      replaceRendererPlugins({ ...selected, generation: "renderer-G2" }),
    ).resolves.toBeDefined();
    expect(
      currentRendererProfile()?.tree.plugins.map((plugin) => plugin.id),
    ).toEqual(["remote-renderer"]);
  });

  it("keeps consumers pending while their provider is disabled and wakes them when it returns", async () => {
    const selected = data("v1");
    const disabled: RendererBootstrapData = {
      ...selected,
      generation: "renderer-v2",
      profileId: "profile-disabled",
      plugins: selected.plugins.filter(
        (plugin) => plugin.id !== "pty-renderer",
      ),
      activationOrder: selected.activationOrder.filter(
        (pluginId) => pluginId !== "pty-renderer",
      ),
      modules: selected.modules.filter(
        (module) => module.pluginId !== "pty-renderer",
      ),
    };
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => selected,
      onRendererPluginProfileChanged: () => () => {},
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    await quiesceRendererPlugins(disabled, ["pty-renderer"]);
    await expect(replaceRendererPlugins(disabled)).resolves.toBeDefined();
    expect(currentRendererProfile()?.runtime.inspect()).toContainEqual({
      pluginId: "terminal-consumer",
      state: "pending",
      missingServices: ["terminal.pty"],
    });

    const reenabled = { ...selected, generation: "renderer-v3" };
    await quiesceRendererPlugins(reenabled, ["pty-renderer"]);
    await expect(replaceRendererPlugins(reenabled)).resolves.toBeDefined();
    expect(currentRendererProfile()?.runtime.inspect()).toContainEqual({
      pluginId: "terminal-consumer",
      state: "active",
    });
  });

  it("maps affected main services only to renderer process bridges", async () => {
    const unchanged = data("v1");
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => unchanged,
      onRendererPluginProfileChanged: () => () => {},
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    const quiesced = await quiesceRendererPlugins(
      unchanged,
      [],
      ["terminal.pty", "company.stable"],
    );

    expect([...quiesced.runtime.activeModules().keys()]).toEqual([
      "stable-renderer",
    ]);
    expect(currentRendererProfile()).toBeDefined();
    expect(globalThis.__rendererTransactionEvents.slice(-2)).toEqual([
      "dispose:terminal-consumer:v1",
      "dispose:pty-renderer:v1",
    ]);
  });

  it("restores previous renderer code on the candidate transport epoch", async () => {
    const previous = remoteData("renderer-G0", "v1");
    const candidate = remoteData("renderer-G1", "v2", { fail: true });
    const remoteCalls: string[] = [];
    let replaceFromMain:
      | ((change: RendererProfileChange) => Promise<{
          ok: boolean;
          generation: string;
          error?: string;
        }>)
      | undefined;
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => previous,
      onRendererPluginProfileChanged: (callback: typeof replaceFromMain) => {
        replaceFromMain = callback;
        return () => {};
      },
      capabilityCallWire: async (call: {
        rendererGeneration?: string;
        method: string;
        args: unknown[];
      }) => {
        remoteCalls.push(
          `${call.method}:${String(call.args[0])}:${String(call.rendererGeneration)}`,
        );
        return { ok: true, value: undefined };
      },
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    const failed = await replaceFromMain?.({
      phase: "activate",
      profile: candidate,
      changedServiceNames: [],
    });
    expect(failed).toEqual({
      ok: false,
      generation: "renderer-G1",
      error: expect.stringContaining("candidate renderer failed"),
    });

    expect(remoteCalls).toEqual([
      "activate:v1:renderer-G0",
      "cleanup:v1:renderer-G0",
      "activate:v2:renderer-G1",
      "activate:v1:renderer-G1",
    ]);

    await quiesceRendererPlugins(candidate, ["remote-renderer"]);
    expect(remoteCalls).toContain("cleanup:v1:renderer-G1");

    await replaceRendererPlugins({ ...previous, generation: "renderer-G2" });
    expect(remoteCalls.at(-1)).toBe("activate:v1:renderer-G2");
  });

  it("restarts a selected process bridge when its remote service returns", async () => {
    const previous = data("G0");
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => previous,
      onRendererPluginProfileChanged: () => () => {},
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    await replaceRendererPlugins(
      { ...previous, generation: "renderer-G1" },
      true,
      ["terminal.pty"],
    );

    expect(globalThis.__rendererTransactionEvents).toEqual([
      "activate:stable-renderer:stable",
      "activate:pty-renderer:G0",
      "activate:terminal-consumer:G0",
      "dispose:terminal-consumer:G0",
      "dispose:pty-renderer:G0",
      "activate:pty-renderer:G0",
      "activate:terminal-consumer:G0",
    ]);
  });

  it("closes the renderer dependency chain from a main-runtime affected seed", async () => {
    const unchanged = data("v1");
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => unchanged,
      onRendererPluginProfileChanged: () => () => {},
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    const quiesced = await quiesceRendererPlugins(unchanged, ["pty-renderer"]);

    expect([...quiesced.runtime.activeModules().keys()]).toEqual([
      "stable-renderer",
    ]);
    expect(currentRendererProfile()).toBeDefined();
    expect(globalThis.__rendererTransactionEvents.slice(-2)).toEqual([
      "dispose:terminal-consumer:v1",
      "dispose:pty-renderer:v1",
    ]);
  });

  it("quiesces the dependency closure before activation and restores it on rollback", async () => {
    const previous = data("v1");
    const candidate = data("v2");
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => previous,
      onRendererPluginProfileChanged: () => () => {},
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    const publications: Array<string[] | null> = [];
    const unsubscribe = subscribeRendererProfile(() => {
      const profile = currentRendererProfile();
      publications.push(
        profile ? [...profile.runtime.activeModules().keys()] : null,
      );
    });
    const quiesced = await quiesceRendererPlugins(candidate, ["pty-renderer"]);

    expect([...quiesced.runtime.activeModules().keys()]).toEqual([
      "stable-renderer",
    ]);
    expect(publications).toEqual([]);
    expect(globalThis.__rendererTransactionEvents.slice(-2)).toEqual([
      "dispose:terminal-consumer:v1",
      "dispose:pty-renderer:v1",
    ]);

    await replaceRendererPlugins(candidate);
    expect(publications.at(-1)).toEqual([
      "stable-renderer",
      "pty-renderer",
      "terminal-consumer",
    ]);
    expect(globalThis.__rendererTransactionEvents).not.toContain(
      "dispose:stable-renderer:stable",
    );
    expect(globalThis.__rendererTransactionEvents).toContain(
      "activate:terminal-consumer:v2",
    );

    await replaceRendererPlugins(previous);
    expect(globalThis.__rendererTransactionEvents).toContain(
      "dispose:terminal-consumer:v2",
    );
    expect(globalThis.__rendererTransactionEvents).toContain(
      "activate:terminal-consumer:v1",
    );
    expect(
      globalThis.__rendererTransactionEvents.filter(
        (event) => event === "activate:stable-renderer:stable",
      ),
    ).toHaveLength(1);
    unsubscribe();
  });

  it("does not feed root observer failures back into plugin rollback", async () => {
    const previous = data("v1");
    const candidate = data("v2");
    globalThis.__rendererTransactionEvents = [];
    (globalThis as { __termco?: unknown }).__termco = {
      rendererPluginProfile: async () => previous,
      onRendererPluginProfileChanged: () => () => {},
      capabilityCallWire: async () => ({ ok: true, value: undefined }),
      registerChannel: () => 1,
      releaseChannel: () => {},
    };

    await bootRendererPlugins();
    const unsubscribe = subscribeRendererProfile(() => {
      if (currentRendererProfile()?.tree.profileId === candidate.profileId) {
        throw new Error("renderer root publication failed");
      }
    });

    await expect(replaceRendererPlugins(candidate)).rejects.toThrow(
      "renderer root publication failed",
    );
    unsubscribe();

    expect(currentRendererProfile()?.tree.profileId).toBe(candidate.profileId);
    expect(globalThis.__rendererTransactionEvents).toContain(
      "activate:terminal-consumer:v2",
    );
    expect(globalThis.__rendererTransactionEvents).not.toContain(
      "dispose:terminal-consumer:v2",
    );
  });
});

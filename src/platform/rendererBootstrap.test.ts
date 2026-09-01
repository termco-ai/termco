import { describe, expect, it, vi } from "vitest";
import type { ResolvedPluginTree, TermcoPluginManifestV3 } from "./contracts";
import { LiveGraphController } from "./liveReplacement";
import {
  createProcessServiceProxy,
  installProcessServices,
  type ProcessHostControl,
  type ProcessTransport,
  processTransportService,
} from "./remoteCapabilities";
import {
  activateRendererProfile,
  deserializeRendererTree,
  serializeRendererBootstrap,
} from "./rendererBootstrap";
import { CapabilityRuntime, type PluginModule } from "./runtime";

function manifest(
  id: string,
  entrypoints: NonNullable<TermcoPluginManifestV3["entrypoints"]>,
): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: id,
    description: id,
    category: "Tests",
    version: "1.0.0",
    entrypoints,
    dependencies: {},
  };
}

function tree(): ResolvedPluginTree {
  const manifests = [
    manifest("main-provider", { main: "src/main.ts" }),
    manifest("local-provider", { renderer: "src/renderer.ts" }),
    manifest("renderer-consumer", { renderer: "src/renderer.ts" }),
  ];
  return {
    profileId: "test-profile",
    plugins: manifests.map((entry) => ({
      id: entry.id,
      manifest: entry,
      source: {
        type: "bundled",
        module: `bundled:plugin-repository/plugins/${entry.id}`,
        location: `plugins/${entry.id}`,
      },
    })),
    activationOrder: manifests.map((entry) => entry.id),
  };
}

describe("renderer profile bootstrap", () => {
  it("round-trips a plain ordered tree without a service graph projection", () => {
    const original = tree();
    const data = serializeRendererBootstrap({
      tree: original,
      modules: [],
    });
    expect(data).not.toHaveProperty("capabilities");
    expect(data).not.toHaveProperty("remoteServices");
    expect(deserializeRendererTree(data)).toEqual(original);
  });

  it("leaves unbridged remote services pending", async () => {
    const original = tree();
    const modules = original.plugins
      .filter((plugin) => plugin.manifest.entrypoints?.renderer)
      .map((plugin) => ({
        pluginId: plugin.id,
        version: "1.0.0",
        integrity: "sha256-test",
        url: `termco-plugin://runtime/${plugin.id}/1.0.0/renderer.mjs`,
      }));
    const transport = vi.fn(
      async (call) => `${call.consumerPluginId}:${call.method}`,
    );
    const disposeLocal = vi.fn();
    const activation = activateRendererProfile({
      data: serializeRendererBootstrap({
        tree: original,
        modules,
      }),
      transport,
      loadModule: async ({ pluginId }) => {
        if (pluginId === "local-provider") {
          return {
            activate(context) {
              context.provide("company.local", { value: "local" });
              return disposeLocal;
            },
          };
        }
        return {
          inject: ["company.local", "company.remote"],
          async activate(context) {
            expect(context.get<{ value: string }>("company.local").value).toBe(
              "local",
            );
            context.get("company.remote");
          },
        };
      },
    });

    await expect(activation).rejects.toThrow(/pending.*company\.remote/i);
    expect(transport).not.toHaveBeenCalled();
    expect(disposeLocal).toHaveBeenCalledOnce();
  });

  it("binds an explicit bridge to its Fiber identity and cleans it up", async () => {
    const provider = manifest("company-provider", { main: "src/main.ts" });
    const bridge = manifest("company-bridge", { renderer: "src/renderer.ts" });
    const consumer = manifest("company-consumer", {
      renderer: "src/renderer.ts",
    });
    const original: ResolvedPluginTree = {
      profileId: "company-profile",
      plugins: [provider, bridge, consumer].map((entry) => ({
        id: entry.id,
        manifest: entry,
        source: {
          type: "local",
          module: entry.id,
          location: entry.id,
        },
      })),
      activationOrder: [provider.id, bridge.id, consumer.id],
    };
    const modules = [bridge, consumer].map((entry) => ({
      pluginId: entry.id,
      version: entry.version,
      integrity: "sha256-test",
      url: `termco-plugin://runtime/${entry.id}/renderer.mjs`,
    }));
    const transport = vi.fn(async (call) => {
      if (
        call.capability === "company.counter" &&
        call.method === "increment"
      ) {
        return Number(call.args[0]) + 1;
      }
      throw new Error("unexpected company bridge call");
    });
    const removeHostSubscription = vi.fn();
    const hostControl = {
      catalog: () => [{ id: "company-provider" }],
      subscribe: vi.fn(() => removeHostSubscription),
    } as unknown as ProcessHostControl;
    let observed: number | undefined;
    const active = await activateRendererProfile({
      data: serializeRendererBootstrap({
        tree: original,
        modules,
      }),
      transport,
      hostControl,
      loadModule: async ({ pluginId }) => {
        if (pluginId === bridge.id) {
          return {
            inject: [processTransportService],
            async activate(context) {
              const processTransport = context.get<ProcessTransport>(
                processTransportService,
              );
              expect(processTransport.hostControl?.catalog()).toEqual([
                { id: "company-provider" },
              ]);
              await context.effect(
                () =>
                  processTransport.hostControl?.subscribe(() => {}) ??
                  (() => {}),
              );
              context.provide(
                "company.counter",
                createProcessServiceProxy("company.counter", processTransport),
              );
            },
          } satisfies PluginModule;
        }
        return {
          inject: ["company.counter"],
          async activate(context) {
            observed = await context
              .get<{ increment(by: number): Promise<number> }>(
                "company.counter",
              )
              .increment(4);
          },
        };
      },
    });

    expect(observed).toBe(5);
    expect(transport).toHaveBeenCalledWith({
      consumerPluginId: bridge.id,
      rendererGeneration: "renderer-unassigned",
      capability: "company.counter",
      method: "increment",
      args: [4],
    });
    expect(active.runtime.serviceProviders()).toContainEqual({
      name: "company.counter",
      providerId: bridge.id,
    });
    await active.dispose();
    expect(removeHostSubscription).toHaveBeenCalledOnce();
    expect(active.runtime.serviceProviders()).toEqual([]);
  });

  it("preserves an unchanged bridge while replacing a changed bridge Fiber", async () => {
    const stable = manifest("stable-bridge", { renderer: "src/renderer.ts" });
    const changedV1 = manifest("changed-bridge", {
      renderer: "src/renderer.ts",
    });
    const consumer = manifest("bridge-consumer", {
      renderer: "src/renderer.ts",
    });
    const makeTree = (changedVersion: string): ResolvedPluginTree => {
      const changed = { ...changedV1, version: changedVersion };
      return {
        profileId: "replacement-profile",
        plugins: [stable, changed, consumer].map((entry) => ({
          id: entry.id,
          manifest: entry,
          source: {
            type: "local",
            module: entry.id,
            location: entry.id,
          },
        })),
        activationOrder: [stable.id, changed.id, consumer.id],
      };
    };
    const activations = new Map<string, number>();
    const bridgeModule = (pluginId: string, service: string): PluginModule => ({
      inject: [processTransportService],
      activate(context) {
        activations.set(pluginId, (activations.get(pluginId) ?? 0) + 1);
        const transport = context.get<ProcessTransport>(
          processTransportService,
        );
        context.provide(service, createProcessServiceProxy(service, transport));
      },
    });
    const consumerModule: PluginModule = {
      inject: ["company.stable", "company.changed"],
      activate() {
        activations.set(consumer.id, (activations.get(consumer.id) ?? 0) + 1);
      },
    };
    const modules = new Map<string, PluginModule>([
      [stable.id, bridgeModule(stable.id, "company.stable")],
      [changedV1.id, bridgeModule(changedV1.id, "company.changed")],
      [consumer.id, consumerModule],
    ]);
    const transport = vi.fn(async (call) => `${call.consumerPluginId}:ok`);
    const initialTree = makeTree("1.0.0");
    const runtime = new CapabilityRuntime(initialTree);
    let removeTransport = installProcessServices(runtime, transport);
    await runtime.activateGraph(async (pluginId) => {
      const module = modules.get(pluginId);
      if (!module) throw new Error(`missing test module ${pluginId}`);
      return module;
    });
    const controller = new LiveGraphController(runtime);
    const candidateTree = makeTree("2.0.0");
    const result = await controller.replace(
      candidateTree,
      async (pluginId) => {
        const module = modules.get(pluginId);
        if (!module) throw new Error(`missing candidate module ${pluginId}`);
        return module;
      },
      () => true,
      {
        prepareCandidateRuntime(candidate) {
          removeTransport();
          removeTransport = installProcessServices(candidate, transport);
        },
      },
    );

    expect(result.status).toBe("replaced");
    expect(activations.get(stable.id)).toBe(1);
    expect(activations.get(changedV1.id)).toBe(2);
    expect(activations.get(consumer.id)).toBe(2);
    await expect(
      controller.runtime
        .platformCapability<{ ping(): Promise<string> }>("company.changed")
        .ping(),
    ).resolves.toBe("changed-bridge:ok");
    await controller.runtime.disposeAll();
    removeTransport();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { ResolvedPluginTree, TermcoPluginManifestV3 } from "./contracts";
import { projectPluginTree } from "./processGraph";
import {
  CapabilityRpcRouter,
  createProcessServiceProxy,
  installProcessServices,
  type ProcessTransport,
  processTransportService,
} from "./remoteCapabilities";
import { CapabilityRuntime } from "./runtime";

function manifest(
  id: string,
  entrypoints: NonNullable<TermcoPluginManifestV3["entrypoints"]>,
): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: id,
    description: id,
    category: "Test",
    version: "1.0.0",
    entrypoints,
    dependencies: {},
  };
}

function tree(
  manifests: readonly TermcoPluginManifestV3[],
): ResolvedPluginTree {
  return {
    profileId: "test.profile",
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

describe("generic cross-process services", () => {
  it("opts a service-family proxy into authenticated caller metadata", async () => {
    const call = vi.fn(async () => undefined);
    const proxy = createProcessServiceProxy<{ ping(): Promise<void> }>(
      "company.authenticated",
      { call } as unknown as ProcessTransport,
      { caller: true },
    );

    await proxy.ping();

    expect(call).toHaveBeenCalledExactlyOnceWith(
      "company.authenticated",
      "ping",
      [],
      { caller: true },
    );
  });

  it("binds generic renderer-local host events with synchronous cleanup", async () => {
    const listeners = new Map<string, (...messages: unknown[]) => void>();
    const disposed: string[] = [];
    const transport = Object.assign(async () => undefined, {
      subscribeHostEvent(
        name: string,
        listener: (...messages: unknown[]) => void,
      ) {
        listeners.set(name, listener);
        return () => {
          disposed.push(name);
          listeners.delete(name);
        };
      },
    });
    const renderer = new CapabilityRuntime(
      tree([manifest("consumer", { renderer: "src/renderer.ts" })]),
    );
    installProcessServices(renderer, transport);
    let hostTransport: ProcessTransport | undefined;
    await renderer.activate("consumer", {
      inject: [processTransportService],
      activate(context) {
        hostTransport = context.get<ProcessTransport>(processTransportService);
      },
    });

    const received: unknown[] = [];
    const dispose = hostTransport?.subscribeHostEvent?.(
      "company.host-event",
      (...messages) => received.push(messages),
    );
    expect(dispose).toBeTypeOf("function");
    listeners.get("company.host-event")?.({ value: 9 });
    expect(received).toEqual([[{ value: 9 }]]);
    dispose?.();
    expect(disposed).toEqual(["company.host-event"]);
    expect(listeners.has("company.host-event")).toBe(false);
  });

  it("lets one plugin's renderer consume an arbitrary service provided by its main entry", async () => {
    const provider = manifest("containers-native", { main: "src/main.ts" });
    const bridge = manifest("containers-bridge", {
      renderer: "src/renderer.ts",
    });
    const consumer = manifest("containers-surface", {
      renderer: "src/renderer.ts",
    });
    const globalTree = tree([provider, bridge, consumer]);
    const main = new CapabilityRuntime(projectPluginTree(globalTree, "main"));
    await main.activate(provider.id, {
      activate: (context) =>
        void context.provide("company.containers", {
          list: async () => ["shared-main-provider"],
        }),
    });

    const renderer = new CapabilityRuntime(
      projectPluginTree(globalTree, "renderer"),
    );
    const router = new CapabilityRpcRouter(globalTree, main);
    const removeTransport = installProcessServices(renderer, (call) =>
      router.dispatch(call),
    );
    await renderer.activate(bridge.id, {
      inject: [processTransportService],
      activate(context) {
        const transport = context.get<ProcessTransport>(
          processTransportService,
        );
        context.provide(
          "company.containers",
          createProcessServiceProxy("company.containers", transport),
        );
      },
    });
    let listed: unknown;
    await renderer.activate(consumer.id, {
      inject: ["company.containers"],
      activate: async (context) => {
        const containers = context.get<{ list(): Promise<string[]> }>(
          "company.containers",
        );
        listed = await containers.list();
      },
    });

    expect(listed).toEqual(["shared-main-provider"]);
    await renderer.disposeAll();
    removeTransport();
  });

  it("routes an injected renderer service without a central contract catalogue", async () => {
    const provider = manifest("secrets-native", { main: "src/main.ts" });
    const consumer = manifest("models-settings", {
      renderer: "src/renderer.ts",
    });
    const bridge = manifest("secrets-bridge", {
      renderer: "src/renderer.ts",
    });
    const globalTree = tree([provider, bridge, consumer]);
    const main = new CapabilityRuntime(projectPluginTree(globalTree, "main"));
    await main.activate(provider.id, {
      activate: (context) => {
        context.provide("company.secrets", {
          get: async (service: string, account: string) =>
            `${service}:${account}:secret`,
        });
      },
    });
    const renderer = new CapabilityRuntime(
      projectPluginTree(globalTree, "renderer"),
    );
    const router = new CapabilityRpcRouter(globalTree, main);
    installProcessServices(renderer, (call) => router.dispatch(call));
    await renderer.activate(bridge.id, {
      inject: [processTransportService],
      activate(context) {
        const transport = context.get<ProcessTransport>(
          processTransportService,
        );
        context.provide(
          "company.secrets",
          createProcessServiceProxy("company.secrets", transport),
        );
      },
    });
    let result: unknown;
    await renderer.activate(consumer.id, {
      inject: ["company.secrets"],
      activate: async (context) => {
        const secrets = context.get<{
          get(service: string, account: string): Promise<string | null>;
        }>("company.secrets");
        result = await secrets.get("termco", "openai");
      },
    });
    expect(result).toBe("termco:openai:secret");
  });

  it("refuses a spoofed consumer identity but does not consult a permission list", async () => {
    const provider = manifest("provider", { main: "src/main.ts" });
    const consumer = manifest("consumer", { renderer: "src/renderer.ts" });
    const globalTree = tree([provider, consumer]);
    const main = new CapabilityRuntime(projectPluginTree(globalTree, "main"));
    await main.activate(provider.id, {
      activate: (context) =>
        void context.provide("company.open", { ping: async () => "pong" }),
    });
    const router = new CapabilityRpcRouter(globalTree, main);

    await expect(
      router.dispatch({
        consumerPluginId: "unknown-plugin",
        capability: "company.open",
        method: "ping",
        args: [],
      }),
    ).rejects.toThrow(/unknown service consumer/);
    await expect(
      router.dispatch({
        consumerPluginId: consumer.id,
        capability: "company.open",
        method: "ping",
        args: [],
      }),
    ).resolves.toBe("pong");
  });

  it("does not expose provider objects or constructor access", async () => {
    const provider = manifest("provider", { main: "src/main.ts" });
    const consumer = manifest("consumer", { renderer: "src/renderer.ts" });
    const globalTree = tree([provider, consumer]);
    const main = new CapabilityRuntime(projectPluginTree(globalTree, "main"));
    await main.activate(provider.id, {
      activate: (context) =>
        void context.provide("company.open", { ping: async () => "pong" }),
    });
    const router = new CapabilityRpcRouter(globalTree, main);
    await expect(
      router.dispatch({
        consumerPluginId: consumer.id,
        capability: "company.open",
        method: "constructor",
        args: [],
      }),
    ).rejects.toThrow(/has no method/);
  });
});

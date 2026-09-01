import { describe, expect, it, vi } from "vitest";
import type { TermcoPluginManifestV3, TermcoProfileV3 } from "./contracts";
import {
  changedPluginIds,
  LiveGraphController,
  LiveReplacementError,
} from "./liveReplacement";
import { projectPluginTree } from "./processGraph";
import { resolvePluginTree } from "./resolve";
import { CapabilityRuntime, type PluginModule } from "./runtime";

const contract = {
  id: "ssh.client",
  version: "1.0.0",
  cardinality: "exclusive",
  process: "main",
  description: "Shared SSH pool",
  destructiveReplacement: { resourceLabel: "SSH sessions" },
};

const storageContract = {
  id: "storage.application",
  version: "1.0.0",
  cardinality: "exclusive",
  process: "main",
  description: "Application storage",
};

function manifest(id: string, replaces?: string): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: id,
    description: id,
    category: "Connectivity",
    version: "1.0.0",
    entrypoints: { main: "src/main.ts" },
    dependencies: {},
    replaces,
  };
}

function graph(
  manifests: TermcoPluginManifestV3[],
  _contracts: unknown[] = [contract],
) {
  const profile: TermcoProfileV3 = {
    schemaVersion: 3,
    id: "test.profile",
    bundles: [],
    plugins: manifests.map((plugin) => ({
      id: plugin.id,
      module: `./${plugin.id}`,
    })),
    patches: [],
  };
  return resolvePluginTree({
    profile,
    manifests: new Map(manifests.map((plugin) => [plugin.id, plugin])),
  });
}

function storageManifest(): TermcoPluginManifestV3 {
  return {
    ...manifest("storage.native"),
    name: "storage.native",
  };
}

function rendererConsumerManifest(): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id: "ssh-status",
    name: "ssh-status",
    description: "Renderer consumer of the application-wide SSH provider",
    category: "Interface",
    version: "1.0.0",
    entrypoints: { renderer: "src/renderer.tsx" },
    dependencies: {},
  };
}

function providerModule(
  name: string,
  active: Set<string>,
  fail = false,
): PluginModule {
  return {
    replacementImpact: () => [
      {
        capability: "ssh.client",
        resourceLabel: "SSH sessions",
        resources: [{ id: "ssh-1", label: "deploy@example.com" }],
      },
    ],
    activate: (ctx) => {
      if (fail) throw new Error(`${name} handshake failed`);
      if (active.size > 0) throw new Error("providers overlapped");
      active.add(name);
      ctx.provide("ssh.client", { name });
      return () => void active.delete(name);
    },
  };
}

describe("LiveGraphController", () => {
  it("reactivates a renderer consumer when its main-process provider is replaced", async () => {
    const original = manifest("ssh.native");
    const replacement = manifest("company.ssh");
    const consumer = rendererConsumerManifest();
    const previousFullGraph = graph([original, consumer]);
    const candidateFullGraph = graph([replacement, consumer]);
    const previousRendererGraph = projectPluginTree(
      previousFullGraph,
      "renderer",
    );
    const candidateRendererGraph = projectPluginTree(
      candidateFullGraph,
      "renderer",
    );
    const activations: string[] = [];
    const cleanup = vi.fn();
    const consumerModule: PluginModule = {
      inject: [contract.id],
      activate: () => {
        activations.push("activated");
        return cleanup;
      },
    };
    const current = new CapabilityRuntime(previousRendererGraph);
    current.installExternalCapability(contract.id, original.id, {
      name: "remote SSH proxy",
    });
    await current.activate(consumer.id, consumerModule);
    const controller = new LiveGraphController(current);
    const replacementOptions = {
      externallyChangedPluginIds: changedPluginIds(
        previousFullGraph,
        candidateFullGraph,
      ),
    };

    await controller.replace(
      candidateRendererGraph,
      async () => consumerModule,
      async () => true,
      replacementOptions,
    );

    expect(activations).toEqual(["activated", "activated"]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps required consumers pending while a provider is disabled and wakes them when it returns", async () => {
    const provider = manifest("git.native");
    const consumer = rendererConsumerManifest();
    const previousGraph = graph([provider, consumer]);
    const disabledGraph = graph([consumer]);
    const activations: string[] = [];
    const providerModule: PluginModule = {
      activate(context) {
        context.provide("git.repository", {});
      },
    };
    const consumerModule: PluginModule = {
      inject: ["git.repository"],
      activate() {
        activations.push("consumer");
      },
    };
    const current = new CapabilityRuntime(previousGraph);
    await current.activate(provider.id, providerModule);
    await current.activate(consumer.id, consumerModule);
    const controller = new LiveGraphController(current);

    await controller.replace(
      disabledGraph,
      async () => consumerModule,
      () => true,
      { allowPendingPluginIds: new Set([consumer.id]) },
    );
    expect(controller.runtime.inspect()).toContainEqual({
      pluginId: consumer.id,
      state: "pending",
      missingServices: ["git.repository"],
    });

    await controller.replace(
      previousGraph,
      async (pluginId) =>
        pluginId === provider.id ? providerModule : consumerModule,
      () => true,
    );
    expect(activations).toEqual(["consumer", "consumer"]);
    controller.runtime.assertSettled();
  });

  it("restores a pending graph when an awakened consumer fails during provider return", async () => {
    const provider = manifest("git.native");
    const consumer = rendererConsumerManifest();
    const enabledGraph = graph([provider, consumer]);
    const disabledGraph = graph([consumer]);
    const providerModule: PluginModule = {
      activate(context) {
        context.provide("git.repository", {});
      },
    };
    let failConsumer = false;
    const consumerModule: PluginModule = {
      inject: ["git.repository"],
      activate() {
        if (failConsumer) throw new Error("consumer failed after wake");
      },
    };
    const current = new CapabilityRuntime(enabledGraph);
    await current.activate(provider.id, providerModule);
    await current.activate(consumer.id, consumerModule);
    const controller = new LiveGraphController(current);

    await controller.replace(
      disabledGraph,
      async () => consumerModule,
      () => true,
      { allowPendingPluginIds: new Set([consumer.id]) },
    );
    failConsumer = true;

    await expect(
      controller.replace(
        enabledGraph,
        async (pluginId) =>
          pluginId === provider.id ? providerModule : consumerModule,
        () => true,
      ),
    ).rejects.toMatchObject({
      phase: "candidate-activation",
      previousProviderRestored: true,
    });
    expect(controller.runtime.inspect()).toContainEqual({
      pluginId: consumer.id,
      state: "pending",
      missingServices: ["git.repository"],
    });
  });

  it("switches external service identities after closing dependent Fibers", async () => {
    const provider = manifest("main-provider");
    const replacement = manifest("company-provider");
    const consumer = rendererConsumerManifest();
    const previousFullTree = graph([provider, consumer]);
    const candidateFullTree = graph([replacement, consumer]);
    const rendererTree = projectPluginTree(previousFullTree, "renderer");
    const runtime = new CapabilityRuntime(rendererTree);
    const generations: string[] = [];
    const consumerModule: PluginModule = {
      inject: [contract.id],
      activate(context) {
        generations.push(
          context.get<{ generation: string }>(contract.id).generation,
        );
      },
    };
    const removePrevious = runtime.installExternalCapability(
      contract.id,
      provider.id,
      { generation: "old" },
    );
    await runtime.activate(consumer.id, consumerModule);
    const controller = new LiveGraphController(runtime);

    await controller.replace(
      projectPluginTree(candidateFullTree, "renderer"),
      async () => consumerModule,
      async () => true,
      {
        externallyChangedPluginIds: changedPluginIds(
          previousFullTree,
          candidateFullTree,
        ),
        prepareCandidateRuntime(candidate) {
          removePrevious();
          candidate.installExternalCapability(contract.id, replacement.id, {
            generation: "new",
          });
        },
      },
    );

    expect(generations).toEqual(["old", "new"]);
    expect(controller.runtime.serviceProviders()).toContainEqual({
      name: contract.id,
      providerId: replacement.id,
    });
  });

  it("detects a source reload of a provider outside the process projection", () => {
    const provider = manifest("ssh.native");
    const consumer = rendererConsumerManifest();
    const previousFullGraph = graph([provider, consumer]);
    const candidateFullGraph = graph([provider, consumer]);
    candidateFullGraph.plugins[0] = {
      ...candidateFullGraph.plugins[0],
      source: {
        ...candidateFullGraph.plugins[0].source,
        integrity: "sha256-edited-provider-generation",
      },
    };

    expect(changedPluginIds(previousFullGraph, candidateFullGraph)).toEqual(
      new Set([provider.id]),
    );
  });

  it("does not restart an unchanged process graph for a renderer-only transaction", async () => {
    const active = new Set<string>();
    const original = manifest("ssh.native");
    const resolved = graph([original]);
    const current = new CapabilityRuntime(resolved);
    const module = providerModule("native", active);
    await current.activate("ssh.native", module);
    const controller = new LiveGraphController(current);
    const load = vi.fn(async () => module);
    const confirm = vi.fn(async () => true);

    await controller.replace(resolved, load, confirm);

    expect(active).toEqual(new Set(["native"]));
    expect(load).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("warns with exact impact and honours cancellation without mutation", async () => {
    const active = new Set<string>();
    const original = manifest("ssh.native");
    const replacement = manifest("company.ssh");
    const current = new CapabilityRuntime(graph([original]));
    await current.activate("ssh.native", providerModule("native", active));
    const controller = new LiveGraphController(current);
    const confirm = vi.fn(async () => false);
    const result = await controller.replace(
      graph([replacement]),
      async () => providerModule("company", active),
      confirm,
    );
    expect(result.status).toBe("cancelled");
    expect(result.warning?.impacts[0].resources[0].label).toBe(
      "deploy@example.com",
    );
    expect(active).toEqual(new Set(["native"]));
  });

  it("quiesces cross-process consumers after confirmation and before provider cleanup", async () => {
    const active = new Set<string>();
    const original = manifest("ssh.native");
    const replacement = manifest("company.ssh");
    const current = new CapabilityRuntime(graph([original]));
    const order: string[] = [];
    await current.activate("ssh.native", {
      replacementImpact: () => [
        {
          capability: "ssh.client",
          resourceLabel: "SSH sessions",
          resources: [{ id: "ssh-1", label: "deploy@example.com" }],
        },
      ],
      activate(context) {
        active.add("native");
        context.provide("ssh.client", {});
        return () => {
          order.push("provider-cleanup");
          active.delete("native");
        };
      },
    });

    const controller = new LiveGraphController(current);
    await controller.replace(
      graph([replacement]),
      async () => providerModule("company", active),
      async () => {
        order.push("confirmed");
        return true;
      },
      {
        beforeDeactivate() {
          order.push("renderer-quiesced");
        },
      },
    );

    expect(order).toEqual([
      "confirmed",
      "renderer-quiesced",
      "provider-cleanup",
    ]);
  });

  it("restores the previous affected slice when provider cleanup fails", async () => {
    const original = manifest("ssh.native");
    const replacement = manifest("company.ssh");
    const current = new CapabilityRuntime(graph([original]));
    let failCleanup = true;
    let activations = 0;
    const originalModule: PluginModule = {
      activate(context) {
        activations += 1;
        context.provide("ssh.client", { generation: "original" });
        return () => {
          if (failCleanup) {
            failCleanup = false;
            throw new Error("native cleanup failed");
          }
        };
      },
    };
    await current.activate(original.id, originalModule);
    const controller = new LiveGraphController(current);

    await expect(
      controller.replace(
        graph([replacement]),
        async () => providerModule("company", new Set()),
        () => true,
        { beforeDeactivate: vi.fn() },
      ),
    ).rejects.toMatchObject({ previousProviderRestored: true });

    expect(activations).toBe(2);
    expect(controller.runtime.serviceProviders()).toContainEqual({
      name: "ssh.client",
      providerId: original.id,
    });
  });

  it("warns when destructive provider source changes under the same plugin id", async () => {
    const active = new Set<string>();
    const original = manifest("ssh.native");
    const currentGraph = graph([original]);
    const candidateGraph = graph([original]);
    candidateGraph.plugins[0] = {
      ...candidateGraph.plugins[0],
      source: {
        ...candidateGraph.plugins[0].source,
        location: "ssh.native-edited",
      },
    };
    const current = new CapabilityRuntime(currentGraph);
    await current.activate("ssh.native", providerModule("native", active));
    const controller = new LiveGraphController(current);
    const confirm = vi.fn(async () => false);

    const result = await controller.replace(
      candidateGraph,
      async () => providerModule("edited", active),
      confirm,
    );

    expect(result.status).toBe("cancelled");
    expect(result.warning?.changedCapabilities).toEqual(["ssh.client"]);
    expect(active).toEqual(new Set(["native"]));
  });

  it("never overlaps exclusive provider generations", async () => {
    const active = new Set<string>();
    const original = manifest("ssh.native");
    const replacement = manifest("company.ssh");
    const current = new CapabilityRuntime(graph([original]));
    await current.activate("ssh.native", providerModule("native", active));
    const controller = new LiveGraphController(current);
    await controller.replace(
      graph([replacement]),
      async () => providerModule("company", active),
      async () => true,
    );
    expect(active).toEqual(new Set(["company"]));
  });

  it("keeps unrelated provider instances active during a replacement", async () => {
    const active = new Set<string>();
    const original = manifest("ssh.native");
    const replacement = manifest("company.ssh");
    const storage = storageManifest();
    const current = new CapabilityRuntime(
      graph([original, storage], [contract, storageContract]),
    );
    const storageCleanup = vi.fn();
    const storageModule: PluginModule = {
      activate: (context) => {
        context.provide(storageContract.id, { read: () => "still-open" });
        return storageCleanup;
      },
    };
    await current.activate(original.id, providerModule("native", active));
    await current.activate(storage.id, storageModule);
    const controller = new LiveGraphController(current);
    const load = vi.fn(async (pluginId: string) => {
      if (pluginId !== replacement.id) {
        throw new Error(`unrelated plugin restarted: ${pluginId}`);
      }
      return providerModule("company", active);
    });

    await controller.replace(
      graph([replacement, storage], [contract, storageContract]),
      load,
      async () => true,
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(storageCleanup).not.toHaveBeenCalled();
    expect(
      controller.runtime
        .platformCapability<{ read(): string }>(storageContract.id)
        .read(),
    ).toBe("still-open");
    await controller.runtime.disposeAll();
    expect(storageCleanup).toHaveBeenCalledTimes(1);
  });

  it("restarts an injected consumer against the candidate provider object", async () => {
    const baseProvider = manifest("feature.provider");
    const upgradedProvider: TermcoPluginManifestV3 = {
      ...baseProvider,
      version: "1.1.0",
    };
    const consumer: TermcoPluginManifestV3 = {
      ...manifest("command-palette"),
    };
    const contracts = [contract];
    const previousGraph = graph([baseProvider, consumer], contracts);
    const current = new CapabilityRuntime(previousGraph);
    const providerModule: PluginModule = {
      activate: (context) =>
        context.provide(contract.id, { generation: "old" }),
    };
    const consumerActivations: string[] = [];
    const consumerModule: PluginModule = {
      inject: [contract.id],
      activate: (context) => {
        consumerActivations.push(
          context.get<{ generation: string }>(contract.id).generation,
        );
      },
    };
    await current.activateGraph(async (pluginId) =>
      pluginId === consumer.id ? consumerModule : providerModule,
    );
    const controller = new LiveGraphController(current);

    await controller.replace(
      graph([upgradedProvider, consumer], contracts),
      async (pluginId) =>
        pluginId === consumer.id
          ? consumerModule
          : {
              activate: (context) => {
                context.provide(contract.id, { generation: "new" });
              },
            },
      async () => true,
    );

    expect(consumerActivations).toEqual(["old", "new"]);
  });

  it("reactivates the old provider and explains destroyed sessions on failure", async () => {
    const active = new Set<string>();
    const original = manifest("ssh.native");
    const replacement = manifest("company.ssh");
    const oldModule = providerModule("native", active);
    const current = new CapabilityRuntime(graph([original]));
    await current.activate("ssh.native", oldModule);
    const controller = new LiveGraphController(current);
    try {
      await controller.replace(
        graph([replacement]),
        async () => providerModule("company", active, true),
        async () => true,
      );
      throw new Error("expected replacement failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LiveReplacementError);
      expect((error as Error).message).toContain("company handshake failed");
      expect((error as Error).message).toContain(
        "Previous provider was restored",
      );
      expect((error as Error).message).toContain("cannot be restored");
    }
    expect(active).toEqual(new Set(["native"]));
  });
});

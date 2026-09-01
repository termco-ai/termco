import { describe, expect, it, vi } from "vitest";
import type { TermcoPluginManifestV3, TermcoProfileV3 } from "./contracts";
import {
  createProcessServiceProxy,
  type ProcessTransport,
} from "./remoteCapabilities";
import { resolvePluginTree } from "./resolve";
import {
  CapabilityRuntime,
  createLiveOptionalFacade,
  kernelEventsService,
  type KernelEventsCapability,
  type PluginModule,
} from "./runtime";

function manifest(
  id: string,
  values: Partial<TermcoPluginManifestV3> & Record<string, unknown>,
): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: id,
    description: id,
    category: "Test",
    version: "1.0.0",
    entrypoints: { utility: "src/index.ts" },
    dependencies: {},
    ...values,
  };
}

function runtimeFor(manifests: TermcoPluginManifestV3[]): CapabilityRuntime {
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
  return new CapabilityRuntime(
    resolvePluginTree({
      profile,
      manifests: new Map(manifests.map((plugin) => [plugin.id, plugin])),
    }),
  );
}

describe("CapabilityRuntime", () => {
  it("keeps a stable optional facade while provider identities change", () => {
    const listeners = new Set<() => void>();
    let current:
      | { snapshot(): number; subscribe(listener: () => void): () => void }
      | undefined;
    const facade = createLiveOptionalFacade(
      {
        current: () => current,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      { snapshot: () => 0, subscribe: () => () => {} },
    );
    const changed = vi.fn();
    facade.value.subscribe(changed);

    current = { snapshot: () => 1, subscribe: () => () => {} };
    for (const listener of listeners) listener();
    expect(facade.value.snapshot()).toBe(1);
    expect(changed).toHaveBeenCalledTimes(1);

    current = undefined;
    for (const listener of listeners) listener();
    expect(facade.value.snapshot()).toBe(0);
    expect(changed).toHaveBeenCalledTimes(2);
    void facade.dispose();
  });

  it("stabilizes fallback snapshots until a provider generation changes", () => {
    const listeners = new Set<() => void>();
    let current:
      | { snapshot(): { revision: number }; subscribe(listener: () => void): () => void }
      | undefined;
    const fallback = {
      snapshot: () => ({ revision: 0 }),
      subscribe: () => () => {},
    };
    const facade = createLiveOptionalFacade(
      {
        current: () => current,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
      fallback,
    );

    const firstFallback = facade.value.snapshot();
    expect(facade.value.snapshot()).toBe(firstFallback);

    const providerSnapshot = { revision: 1 };
    current = {
      snapshot: () => providerSnapshot,
      subscribe: () => () => {},
    };
    for (const listener of listeners) listener();
    expect(facade.value.snapshot()).toBe(providerSnapshot);

    current = undefined;
    for (const listener of listeners) listener();
    const nextFallback = facade.value.snapshot();
    expect(nextFallback).not.toBe(firstFallback);
    expect(facade.value.snapshot()).toBe(nextFallback);
    void facade.dispose();
  });

  it("forwards provider subscription arguments through a stable optional facade", () => {
    let providerListener: ((key: string, value: unknown) => void) | undefined;
    const current = {
      subscribe(listener: (key: string, value: unknown) => void) {
        providerListener = listener;
        return () => {
          providerListener = undefined;
        };
      },
    };
    const facade = createLiveOptionalFacade(
      { current: () => current, subscribe: () => () => {} },
      { subscribe: () => () => {} },
    );
    const changed = vi.fn();
    facade.value.subscribe(changed);

    providerListener?.("zoomLevel", 1.1);

    expect(changed).toHaveBeenCalledExactlyOnceWith("zoomLevel", 1.1);
    void facade.dispose();
  });

  it("does not bind a synchronous optional subscription to a generic process proxy", async () => {
    const observers = new Set<() => void>();
    const call = vi.fn(async () => undefined);
    let current:
      | { snapshot(): Promise<number>; subscribe(listener: () => void): () => void }
      | undefined = createProcessServiceProxy(
        "workspace.remote-state",
        { call } as unknown as ProcessTransport,
      );
    const facade = createLiveOptionalFacade(
      {
        current: () => current,
        subscribe(listener) {
          observers.add(listener);
          return () => {
            observers.delete(listener);
          };
        },
      },
      { snapshot: async () => 0, subscribe: () => () => {} },
    );

    current = undefined;
    expect(() => {
      for (const observer of observers) observer();
    }).not.toThrow();
    expect(call).not.toHaveBeenCalledWith(
      "workspace.remote-state",
      "subscribe",
      expect.anything(),
    );
    await facade.dispose();
  });

  it("keeps one kernel event bus available without a removable provider", async () => {
    const runtime = runtimeFor([
      manifest("event.consumer", {}),
      manifest("unrelated.plugin", {}),
    ]);
    const received: unknown[] = [];

    await runtime.activate("event.consumer", {
      activate(context) {
        const events = context.get<KernelEventsCapability>(kernelEventsService);
        return events.subscribe("workspace.changed", (payload) => {
          received.push(payload);
        });
      },
    });
    await runtime.activate("unrelated.plugin", { activate: () => {} });

    await runtime.callCapability(kernelEventsService, "emit", [
      "workspace.changed",
      { revision: 2 },
    ]);
    expect(received).toEqual([{ revision: 2 }]);

    await runtime.deactivate("unrelated.plugin");
    await runtime.callCapability(kernelEventsService, "emit", [
      "workspace.changed",
      { revision: 3 },
    ]);
    expect(received).toEqual([{ revision: 2 }, { revision: 3 }]);
    expect(runtime.serviceProviders()).not.toContainEqual({
      name: kernelEventsService,
      providerId: "kernel",
    });
  });

  it("shares exactly one provider-owned SSH runtime with every consumer", async () => {
    const provider = manifest("ssh.native", {
      provides: [{ capability: "ssh.client", version: "1.0.0" }],
    });
    const terminal = manifest("terminal.ui", {
      consumes: [{ capability: "ssh.client", version: "^1" }],
    });
    const forwarding = manifest("port-forwarding.ui", {
      consumes: [{ capability: "ssh.client", version: "^1" }],
    });
    const runtime = runtimeFor([terminal, provider, forwarding]);
    const pool = { connections: new Map() };
    const observed: unknown[] = [];
    await runtime.activate("ssh.native", {
      activate: (ctx) => void ctx.provide("ssh.client", pool),
    });
    await runtime.activate("port-forwarding.ui", {
      inject: ["ssh.client"],
      activate: (ctx) => void observed.push(ctx.get("ssh.client")),
    });
    await runtime.activate("terminal.ui", {
      inject: ["ssh.client"],
      activate: (ctx) => void observed.push(ctx.get("ssh.client")),
    });
    expect(observed).toEqual([pool, pool]);
  });

  it("projects remote services with the requesting plugin identity", async () => {
    const provider = manifest("ssh.native", {
      provides: [{ capability: "ssh.client", version: "1.0.0" }],
    });
    const terminal = manifest("terminal.ui", {
      consumes: [{ capability: "ssh.client", version: "^1" }],
    });
    const unrelated = manifest("unrelated.ui", {});
    const runtime = runtimeFor([provider, terminal, unrelated]);
    const projection = { connectionPool: "shared" };
    runtime.installExternalCapabilityFactory(
      "ssh.client",
      "ssh.native",
      (consumerPluginId) => ({ ...projection, consumerPluginId }),
    );

    let received: unknown;
    await runtime.activate("terminal.ui", {
      inject: ["ssh.client"],
      activate: (context) => {
        received = context.get("ssh.client");
      },
    });
    expect(received).toEqual({
      ...projection,
      consumerPluginId: "terminal.ui",
    });
    let optional: unknown;
    await runtime.activate("unrelated.ui", {
      optionalInject: ["ssh.client"],
      activate: (context) => {
        optional = context.observe("ssh.client").current();
      },
    });
    expect(optional).toEqual({
      ...projection,
      consumerPluginId: "unrelated.ui",
    });
  });

  it("observes optional providers without restarting the consumer", async () => {
    const provider = manifest("git.native", {});
    const consumer = manifest("terminal.ui", {});
    const runtime = runtimeFor([provider, consumer]);
    const providerValues = [{ generation: 1 }, { generation: 2 }];
    const snapshots: unknown[] = [];
    let activations = 0;
    let generation = 0;
    const consumerModule: PluginModule = {
      optionalInject: ["git.repository"],
      async activate(context) {
        activations += 1;
        const git = context.observe("git.repository");
        snapshots.push(git.current());
        await context.effect(() =>
          git.subscribe(() => snapshots.push(git.current())),
        );
      },
    };

    await runtime.activate(provider.id, {
      activate: (context) =>
        context.provide("git.repository", providerValues[generation++]),
    });
    await runtime.activate(consumer.id, consumerModule);
    expect(snapshots).toEqual([providerValues[0]]);

    await runtime.deactivate(provider.id);
    expect(runtime.inspect()).toContainEqual({ pluginId: consumer.id, state: "active" });
    expect(runtime.dependencyClosedPluginIds(new Set([provider.id]))).toEqual(new Set([provider.id]));
    expect(activations).toBe(1);
    expect(snapshots).toEqual([providerValues[0], undefined]);

    await runtime.activate(provider.id, {
      activate: (context) =>
        context.provide("git.repository", providerValues[generation++]),
    });
    expect(activations).toBe(1);
    expect(snapshots).toEqual([providerValues[0], undefined, providerValues[1]]);
  });

  it("previews hard, feature, optional, and destructive removal impact", async () => {
    const provider = manifest("git.native", {});
    const hardConsumer = manifest("workflows.native", {});
    const transitiveConsumer = manifest("workflow.tools", {});
    const optionalConsumer = manifest("terminal.surface", {});
    const featureOwner = manifest("explorer.sidebar", {});
    const runtime = runtimeFor([
      provider,
      hardConsumer,
      transitiveConsumer,
      optionalConsumer,
      featureOwner,
    ]);
    await runtime.activate(provider.id, {
      activate: (context) => context.provide("git.repository", {}),
      replacementImpact: () => [
        {
          capability: "git.repository",
          resourceLabel: "repository watchers",
          resources: [{ id: "repo-1", label: "Workspace" }],
        },
      ],
    });
    await runtime.activate(hardConsumer.id, {
      inject: ["git.repository"],
      activate: (context) => context.provide("workflows.library", {}),
    });
    await runtime.activate(transitiveConsumer.id, {
      inject: ["workflows.library"],
      activate: () => {},
    });
    await runtime.activate(optionalConsumer.id, {
      optionalInject: ["git.repository"],
      activate: (context) => void context.observe("git.repository"),
    });
    await runtime.activate(featureOwner.id, {
      activate: (context) => {
        context.feature(
          {
            id: "git-decorations",
            label: "Git decorations",
            requires: ["git.repository"],
            uiPolicy: "remove",
          },
          () => {},
        );
      },
    });

    await expect(runtime.previewPluginRemoval(provider.id)).resolves.toEqual({
      blockedPlugins: [
        {
          pluginId: hardConsumer.id,
          missingServices: ["git.repository"],
          via: ["git.repository"],
        },
        {
          pluginId: transitiveConsumer.id,
          missingServices: ["workflows.library"],
          via: ["workflows.library"],
        },
      ],
      unavailableFeatures: [
        {
          pluginId: featureOwner.id,
          featureId: "git-decorations",
          label: "Git decorations",
          uiPolicy: "remove",
          missingServices: ["git.repository"],
        },
      ],
      degradedPlugins: [
        {
          pluginId: optionalConsumer.id,
          optionalServices: ["git.repository"],
        },
      ],
      destructiveResources: [
        {
          capability: "git.repository",
          resourceLabel: "repository watchers",
          resources: [{ id: "repo-1", label: "Workspace" }],
        },
      ],
    });
  });

  it("removes and restores only a dependency-owned child feature", async () => {
    const provider = manifest("git.native", {});
    const parent = manifest("workflows.native", {});
    const runtime = runtimeFor([provider, parent]);
    const activeContributions: string[] = [];
    let providerGeneration = 0;
    let parentActivations = 0;
    let featureActivations = 0;
    let featureDisposals = 0;

    const activateProvider = () =>
      runtime.activate(provider.id, {
        activate: (context) =>
          context.provide("git.repository", {
            id: `git-${++providerGeneration}`,
          }),
      });

    await activateProvider();
    await runtime.activate(parent.id, {
      activate(context) {
        parentActivations += 1;
        context.feature(
          {
            id: "git-workflows",
            label: "Git workflows",
            requires: ["git.repository"],
            uiPolicy: "remove",
          },
          async (feature) => {
            featureActivations += 1;
            const git = feature.get<{ id: string }>("git.repository");
            activeContributions.push(git.id);
            await feature.effect(() => () => {
              featureDisposals += 1;
              activeContributions.splice(activeContributions.indexOf(git.id), 1);
            });
          },
        );
      },
    });

    expect(activeContributions).toEqual(["git-1"]);
    expect(runtime.inspectFeatures()).toEqual([
      {
        pluginId: parent.id,
        featureId: "git-workflows",
        label: "Git workflows",
        state: "active",
        requires: ["git.repository"],
        missingServices: [],
        uiPolicy: "remove",
      },
    ]);

    await runtime.deactivate(provider.id);
    expect(parentActivations).toBe(1);
    expect(featureActivations).toBe(1);
    expect(featureDisposals).toBe(1);
    expect(activeContributions).toEqual([]);
    expect(runtime.inspectFeatures()).toContainEqual({
      pluginId: parent.id,
      featureId: "git-workflows",
      label: "Git workflows",
      state: "pending",
      requires: ["git.repository"],
      missingServices: ["git.repository"],
      uiPolicy: "remove",
    });

    await activateProvider();
    expect(parentActivations).toBe(1);
    expect(featureActivations).toBe(2);
    expect(featureDisposals).toBe(1);
    expect(activeContributions).toEqual(["git-2"]);
  });

  it("reports a failed child feature without failing its parent", async () => {
    const parent = manifest("workflows.native", {});
    const runtime = runtimeFor([parent]);
    const cleanup = vi.fn();

    await runtime.activate(parent.id, {
      activate(context) {
        context.feature(
          {
            id: "broken-runner",
            label: "Broken runner",
            requires: [],
            uiPolicy: "retain-disabled",
          },
          async (feature) => {
            await feature.effect(() => cleanup);
            throw new Error("runner activation failed");
          },
        );
      },
    });

    expect(runtime.inspect()).toContainEqual({ pluginId: parent.id, state: "active" });
    expect(runtime.inspectFeatures()).toContainEqual({
      pluginId: parent.id,
      featureId: "broken-runner",
      label: "Broken runner",
      state: "failed",
      requires: [],
      missingServices: [],
      uiPolicy: "retain-disabled",
      error: expect.objectContaining({ message: "runner activation failed" }),
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(() => runtime.assertSettled()).toThrow(
      'plugin "workflows.native" feature "broken-runner" failed: runner activation failed',
    );
  });

  it("lets a child feature read a parent-optional service that it explicitly requires", async () => {
    const provider = manifest("git.native", {});
    const parent = manifest("workflows.native", {});
    const runtime = runtimeFor([provider, parent]);
    const repository = { root: "/repo" };
    let observed: unknown;

    await runtime.activate(parent.id, {
      optionalInject: ["git.repository"],
      activate(context) {
        context.feature(
          {
            id: "git-workflows",
            label: "Git workflows",
            requires: ["git.repository"],
            uiPolicy: "remove",
          },
          (scope) => {
            observed = scope.get("git.repository");
          },
        );
      },
    });
    await runtime.activate(provider.id, {
      activate: (context) => context.provide("git.repository", repository),
    });

    expect(observed).toBe(repository);
    expect(runtime.inspectFeatures()).toContainEqual(
      expect.objectContaining({ featureId: "git-workflows", state: "active" }),
    );
  });

  it("owns nested features beneath their parent lifecycle", async () => {
    const provider = manifest("git.native", {});
    const parent = manifest("workflows.native", {});
    const runtime = runtimeFor([provider, parent]);
    const lifecycle: string[] = [];
    const providerModule: PluginModule = {
      activate: (context) => context.provide("git.repository", {}),
    };

    await runtime.activate(provider.id, providerModule);
    await runtime.activate(parent.id, {
      activate(context) {
        context.feature(
          {
            id: "git-workflows",
            label: "Git workflows",
            requires: ["git.repository"],
            uiPolicy: "remove",
          },
          async (gitFeature) => {
            lifecycle.push("activate:git");
            await gitFeature.effect(() => () => {
              lifecycle.push("dispose:git");
            });
            gitFeature.feature(
              {
                id: "git-workflows/header-action",
                label: "Git workflow header action",
                requires: [],
                uiPolicy: "remove",
              },
              (headerFeature) => {
                lifecycle.push("activate:header");
                return headerFeature.effect(() => () => {
                  lifecycle.push("dispose:header");
                });
              },
            );
          },
        );
      },
    });
    expect(lifecycle).toEqual(["activate:git", "activate:header"]);

    await runtime.deactivate(provider.id);
    expect(lifecycle).toEqual([
      "activate:git",
      "activate:header",
      "dispose:header",
      "dispose:git",
    ]);
    expect(runtime.inspectFeatures().map((feature) => feature.featureId)).toEqual([
      "git-workflows",
    ]);

    await runtime.activate(provider.id, providerModule);
    expect(lifecycle).toEqual([
      "activate:git",
      "activate:header",
      "dispose:header",
      "dispose:git",
      "activate:git",
      "activate:header",
    ]);
  });

  it("rejects hidden optional reads that bypass observation", async () => {
    const consumer = manifest("terminal.ui", {});
    const runtime = runtimeFor([consumer]);

    await expect(
      runtime.activate(consumer.id, {
        optionalInject: ["git.repository"],
        activate(context) {
          context.get("git.repository");
        },
      }),
    ).rejects.toThrow(
      'plugin "terminal.ui" must use observe() for optional service "git.repository"',
    );
  });

  it("adopts child features and optional observers into a successor runtime", async () => {
    const provider = manifest("git.native", {});
    const parent = manifest("workflows.native", {});
    const source = runtimeFor([provider, parent]);
    const successor = runtimeFor([provider, parent]);
    const observed: unknown[] = [];
    const featureCleanup = vi.fn();

    await source.activate(provider.id, {
      activate: (context) => context.provide("git.repository", { generation: 1 }),
    });
    await source.activate(parent.id, {
      optionalInject: ["git.repository"],
      async activate(context) {
        const git = context.observe("git.repository");
        await context.effect(() =>
          git.subscribe(() => observed.push(git.current())),
        );
        context.feature(
          {
            id: "git-workflows",
            label: "Git workflows",
            requires: ["git.repository"],
            uiPolicy: "remove",
          },
          () => featureCleanup,
        );
      },
    });

    successor.adoptRegisteredPluginsFrom(
      source,
      new Set([provider.id, parent.id]),
    );
    expect(successor.inspectFeatures()).toHaveLength(1);

    await successor.deactivate(provider.id);
    expect(featureCleanup).toHaveBeenCalledOnce();
    expect(observed).toEqual([undefined]);
    expect(successor.inspect()).toContainEqual({ pluginId: parent.id, state: "active" });
    expect(successor.inspectFeatures()).toContainEqual(
      expect.objectContaining({ featureId: "git-workflows", state: "pending" }),
    );
  });

  it("suspends child features before an external provider disappears", async () => {
    const provider = manifest("git.native", {});
    const parent = manifest("workflows.native", {});
    const runtime = runtimeFor([provider, parent]);
    const cleanup = vi.fn();
    const removeGit = runtime.installExternalCapability(
      "git.repository",
      provider.id,
      {},
    );

    await runtime.activate(parent.id, {
      activate(context) {
        context.feature(
          {
            id: "git-workflows",
            label: "Git workflows",
            requires: ["git.repository"],
            uiPolicy: "remove",
          },
          () => cleanup,
        );
      },
    });

    await removeGit();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(runtime.inspectFeatures()).toContainEqual(
      expect.objectContaining({
        featureId: "git-workflows",
        state: "pending",
        missingServices: ["git.repository"],
      }),
    );
  });

  it("rejects duplicate feature ids without leaking the first registration", async () => {
    const parent = manifest("workflows.native", {});
    const runtime = runtimeFor([parent]);
    const descriptor = {
      id: "git-workflows",
      label: "Git workflows",
      requires: [],
      uiPolicy: "remove" as const,
    };

    await expect(
      runtime.activate(parent.id, {
        activate(context) {
          context.feature(descriptor, () => {});
          context.feature(descriptor, () => {});
        },
      }),
    ).rejects.toThrow(
      'plugin "workflows.native" already registered feature "git-workflows"',
    );
    expect(runtime.inspectFeatures()).toEqual([]);
  });

  it("suspends hard consumers before a child-provided service disappears", async () => {
    const git = manifest("git.native", {});
    const workflows = manifest("workflows.native", {});
    const consumer = manifest("git-workflow-tools", {});
    const runtime = runtimeFor([git, workflows, consumer]);
    const consumerCleanup = vi.fn();
    let consumerActivations = 0;
    const gitModule: PluginModule = {
      activate: (context) => context.provide("git.repository", {}),
    };

    await runtime.activate(git.id, gitModule);
    await runtime.activate(workflows.id, {
      activate(context) {
        context.feature(
          {
            id: "git-workflows",
            label: "Git workflows",
            requires: ["git.repository"],
            uiPolicy: "remove",
          },
          (feature) => {
            feature.provide("workflows.git", {});
          },
        );
      },
    });
    await runtime.activate(consumer.id, {
      inject: ["workflows.git"],
      activate(context) {
        context.get("workflows.git");
        consumerActivations += 1;
        return consumerCleanup;
      },
    });

    await runtime.deactivate(git.id);
    expect(consumerCleanup).toHaveBeenCalledOnce();
    expect(runtime.inspect()).toContainEqual({
      pluginId: consumer.id,
      state: "pending",
      missingServices: ["workflows.git"],
    });
    expect(runtime.inspect()).toContainEqual({ pluginId: workflows.id, state: "active" });

    await runtime.activate(git.id, gitModule);
    expect(consumerActivations).toBe(2);
    expect(runtime.inspect()).toContainEqual({ pluginId: consumer.id, state: "active" });
  });

  it("removes every provider value and effect on disposal", async () => {
    const disposeResource = vi.fn();
    const provider = manifest("ssh.native", {
      provides: [{ capability: "ssh.client", version: "1.0.0" }],
    });
    const runtime = runtimeFor([provider]);
    await runtime.activate("ssh.native", {
      activate: async (ctx) => {
        ctx.provide("ssh.client", {});
        await ctx.effect(() => disposeResource);
      },
    });
    await runtime.deactivate("ssh.native");
    expect(disposeResource).toHaveBeenCalledOnce();
    expect(runtime.inspect()).toEqual([
      { pluginId: "ssh.native", state: "inactive" },
    ]);
  });

  it("reports cleanup failures after attempting every registered disposer", async () => {
    const firstCleanup = vi.fn(() => {
      throw new Error("first cleanup failed");
    });
    const secondCleanup = vi.fn();
    const provider = manifest("ssh.native", {
      provides: [{ capability: "ssh.client", version: "1.0.0" }],
    });
    const runtime = runtimeFor([provider]);
    await runtime.activate("ssh.native", {
      activate: async (context) => {
        context.provide("ssh.client", {});
        await context.effect(() => firstCleanup);
        await context.effect(() => secondCleanup);
      },
    });

    await expect(runtime.deactivate("ssh.native")).rejects.toThrow(
      'plugin "ssh.native" cleanup failed',
    );
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(runtime.inspect()).toEqual([
      { pluginId: "ssh.native", state: "inactive" },
    ]);
    expect(runtime.lifecycleDiagnostics("ssh.native")).toMatchObject({
      registrations: 3,
      disposals: 3,
      activeEffects: 0,
      cleanupFailures: 1,
    });
  });

  it("continues deactivating unrelated plugins after one plugin cleanup fails", async () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn(() => {
      throw new Error("second plugin cleanup failed");
    });
    const first = manifest("header.first", {
      provides: [
        { capability: "ui.header.items", version: "1.0.0", key: "first" },
      ],
    });
    const second = manifest("header.second", {
      provides: [
        { capability: "ui.header.items", version: "1.0.0", key: "second" },
      ],
    });
    const runtime = runtimeFor([first, second]);
    await runtime.activate("header.first", {
      activate(context) {
        context.provide("test.header.first", {});
        return firstCleanup;
      },
    });
    await runtime.activate("header.second", {
      activate(context) {
        context.provide("test.header.second", {});
        return secondCleanup;
      },
    });

    await expect(runtime.disposeAll()).rejects.toThrow(
      "plugin graph cleanup failed",
    );
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(runtime.inspect()).toEqual([
      { pluginId: "header.first", state: "inactive" },
      { pluginId: "header.second", state: "inactive" },
    ]);
  });

  it("records and removes partial effects when activation fails", async () => {
    const cleanup = vi.fn();
    const provider = manifest("ssh.native", {
      provides: [{ capability: "ssh.client", version: "1.0.0" }],
    });
    const runtime = runtimeFor([provider]);

    await expect(
      runtime.activate("ssh.native", {
        activate: async (context) => {
          context.provide("ssh.client", {});
          await context.effect(() => cleanup);
          throw new Error("activation failed after registration");
        },
      }),
    ).rejects.toThrow("activation failed after registration");

    expect(cleanup).toHaveBeenCalledOnce();
    expect(runtime.lifecycleDiagnostics("ssh.native")).toMatchObject({
      activationAttempts: 1,
      successfulActivations: 0,
      failedActivations: 1,
      registrations: 2,
      disposals: 2,
      activeEffects: 0,
      cleanupFailures: 0,
    });
  });

  it("rolls the graph back when any required plugin fails", async () => {
    const providerCleanup = vi.fn();
    const provider = manifest("ssh.native", {
      provides: [{ capability: "ssh.client", version: "1.0.0" }],
    });
    const consumer = manifest("terminal.ui", {
      consumes: [{ capability: "ssh.client", version: "^1" }],
    });
    const runtime = runtimeFor([provider, consumer]);
    await expect(
      runtime.activateGraph(async (id) =>
        id === "ssh.native"
          ? {
              activate: (ctx) => {
                ctx.provide("ssh.client", {});
                return providerCleanup;
              },
            }
          : {
              activate: () => {
                throw new Error("renderer failed");
              },
            },
      ),
    ).rejects.toThrow("renderer failed");
    expect(providerCleanup).toHaveBeenCalledOnce();
  });

  it("exposes keyed contributions through an ordinary registry service", async () => {
    const contributor = manifest("header.branch", {
      provides: [
        { capability: "ui.header.items", version: "1.0.0", key: "git.branch" },
      ],
    });
    const header = manifest("header.ui", {
      consumes: [{ capability: "ui.header.items", version: "^1" }],
    });
    const runtime = runtimeFor([contributor, header]);
    const item = { render: () => "main" };
    const contributions = new Map<
      string,
      { pluginId: string; value: unknown }
    >();
    const registry = {
      register(key: string, pluginId: string, value: unknown) {
        contributions.set(key, { pluginId, value });
        return () => void contributions.delete(key);
      },
      entries() {
        return [...contributions].map(([key, entry]) => ({ key, ...entry }));
      },
    };
    await runtime.activate("header.ui", {
      activate: (ctx) => void ctx.provide("ui.header.items", registry),
    });
    await runtime.activate("header.branch", {
      inject: ["ui.header.items"],
      async activate(ctx) {
        const injected = ctx.get<typeof registry>("ui.header.items");
        await ctx.effect(() =>
          injected.register("git.branch", ctx.pluginId, item),
        );
      },
    });
    expect(registry.entries()).toEqual([
      { key: "git.branch", pluginId: "header.branch", value: item },
    ]);
  });

  it("fails graph settlement with the pending Fiber and every missing service", async () => {
    const consumer = manifest("pending.consumer", {});
    const runtime = runtimeFor([consumer]);

    await expect(
      runtime.activateGraph(async () => ({
        inject: ["company.counter", "company.telemetry"],
        activate: () => {
          throw new Error("a pending Fiber must not activate");
        },
      })),
    ).rejects.toThrow(
      /pending\.consumer.*company\.counter, company\.telemetry/s,
    );
    expect(runtime.inspect()).toEqual([
      { pluginId: "pending.consumer", state: "inactive" },
    ]);
  });

  it("rejects services reserved for kernel internals", async () => {
    const runtime = runtimeFor([manifest("ordinary-ui", {})]);

    await expect(
      runtime.activate("ordinary-ui", {
        activate(context) {
          context.provide("kernel.context", {});
        },
      }),
    ).rejects.toThrow('service "kernel.context" is reserved by the kernel');
  });

  it("reserves the process transport for a caller-bound kernel factory", async () => {
    const runtime = runtimeFor([manifest("ordinary-ui", {})]);

    const removeTransport = runtime.installExternalCapabilityFactory(
      "kernel.process-transport",
      "kernel",
      (pluginId) => ({ pluginId }),
    );
    removeTransport();
    expect(() =>
      runtime.installExternalCapability(
        "kernel.process-transport",
        "spoofed-provider",
        {},
      ),
    ).toThrow('service "kernel.process-transport" is reserved by the kernel');
    await expect(
      runtime.activate("ordinary-ui", {
        activate(context) {
          context.provide("kernel.process-transport", {});
        },
      }),
    ).rejects.toThrow(
      'service "kernel.process-transport" is reserved by the kernel',
    );
  });
});

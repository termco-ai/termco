import { describe, expect, it, vi } from "vitest";
import type { TermcoPluginManifestV3, TermcoProfileV3 } from "./contracts";
import {
  certifyPluginLifecycle,
  type LifecycleResourceSnapshot,
} from "./lifecycleCertification";
import { resolvePluginTree } from "./resolve";
import { CapabilityRuntime, type PluginModule } from "./runtime";

const service = "test.contribution";

const manifest: TermcoPluginManifestV3 = {
  schemaVersion: 3,
  id: "lifecycle-subject",
  name: "Lifecycle subject",
  description: "Exercises the public lifecycle contract",
  category: "Test",
  version: "1.0.0",
  entrypoints: { renderer: "src/renderer.ts" },
  dependencies: {},
};

function createRuntime(): CapabilityRuntime {
  const profile: TermcoProfileV3 = {
    schemaVersion: 3,
    id: "lifecycle.profile",
    bundles: [],
    plugins: [
      {
        id: manifest.id,
        module: `./${manifest.id}`,
      },
    ],
    patches: [],
  };
  return new CapabilityRuntime(
    resolvePluginTree({
      profile,
      manifests: new Map([[manifest.id, manifest]]),
    }),
  );
}

describe("certifyPluginLifecycle", () => {
  it("uses the real module boundary for registration, cleanup, repeat, and every partial-failure prefix", async () => {
    const listeners = new Set<() => void>();
    const timers = new Set<number>();
    let nextTimer = 0;
    const module: PluginModule = {
      async activate(context) {
        context.provide(service, { label: "subject" }, "subject");
        await context.effect(() => {
          const listener = () => {};
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        });
      },
    };
    // Every resource is enrolled in the scope immediately after installation.
    const wrappedModule: PluginModule = {
      async activate(context) {
        await context.effect(() => {
          const timer = ++nextTimer;
          timers.add(timer);
          return () => {
            timers.delete(timer);
          };
        });
        await module.activate(context);
      },
    };
    const snapshot = (): LifecycleResourceSnapshot => ({
      listeners: listeners.size,
      timers: timers.size,
    });

    const certificate = await certifyPluginLifecycle({
      pluginId: manifest.id,
      module: wrappedModule,
      createRuntime,
      snapshotResources: snapshot,
    });

    expect(certificate).toEqual({
      pluginId: manifest.id,
      effectsPerSuccessfulCycle: 3,
      successfulCycles: 2,
      failurePrefixesTested: 3,
      cleanupFailures: 0,
    });
    expect(snapshot()).toEqual({ listeners: 0, timers: 0 });
  });

  it("rejects a plugin whose disposer leaves an external resource behind", async () => {
    const listeners = new Set<() => void>();
    const leakingModule: PluginModule = {
      activate(context) {
        context.provide(service, {}, "subject");
        listeners.add(() => {});
        return () => {};
      },
    };

    await expect(
      certifyPluginLifecycle({
        pluginId: manifest.id,
        module: leakingModule,
        createRuntime,
        snapshotResources: () => ({ listeners: listeners.size }),
      }),
    ).rejects.toThrow(
      'plugin "lifecycle-subject" leaked resources after successful cycle 1',
    );
  });

  it("rejects lifecycle bookkeeping that never exposes a product effect", async () => {
    const bookkeepingOnlyModule: PluginModule = {
      async activate(context) {
        await context.effect(() => () => {});
      },
    };

    await expect(
      certifyPluginLifecycle({
        pluginId: manifest.id,
        module: bookkeepingOnlyModule,
        createRuntime,
        snapshotResources: () => ({}),
      }),
    ).rejects.toThrow(
      'plugin "lifecycle-subject" exposed no observable product effect while active',
    );
  });

  it("rejects cleanup deferred until return when an earlier registration can fail", async () => {
    let openWatchers = 0;
    const deferredCleanupModule: PluginModule = {
      activate(context) {
        openWatchers += 1;
        context.provide(service, {}, "subject");
        return () => {
          openWatchers -= 1;
        };
      },
    };

    await expect(
      certifyPluginLifecycle({
        pluginId: manifest.id,
        module: deferredCleanupModule,
        createRuntime,
        snapshotResources: () => ({ openWatchers }),
      }),
    ).rejects.toThrow(
      'plugin "lifecycle-subject" leaked resources after activation failure prefix 1',
    );
  });

  it("rejects cleanup callbacks that throw even when the resource snapshot looks clean", async () => {
    const cleanup = vi.fn(() => {
      throw new Error("disposer failed");
    });
    const brokenModule: PluginModule = {
      activate(context) {
        context.provide(service, {}, "subject");
        return cleanup;
      },
    };

    await expect(
      certifyPluginLifecycle({
        pluginId: manifest.id,
        module: brokenModule,
        createRuntime,
        snapshotResources: () => ({}),
      }),
    ).rejects.toThrow('plugin "lifecycle-subject" cleanup failed');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

// @vitest-environment node
import type {
  BootDiagnostic,
  BootDiagnosticsCapability,
} from "@termco/application-base";
import type { StorageCapability, StorageHandle } from "@termco/storage-base";
import { describe, expect, it, vi } from "vitest";
import plugin from "./main";

describe("boot diagnostics provider", () => {
  it("records, reads, and clears through shared durable storage", async () => {
    const values = new Map<string, unknown>();
    const handle: StorageHandle = {
      get: (key) => values.get(key) as never,
      set: (key, value) => void values.set(key, value),
      has: (key) => values.has(key),
      delete: (key) => values.delete(key),
      keys: () => [...values.keys()],
      values: () => [...values.values()],
      entries: () => [...values.entries()],
      clear: () => values.clear(),
      reset: () => values.clear(),
      save: vi.fn(async () => {}),
    };
    const storage: StorageCapability = {
      open: vi.fn(async () => handle),
      close: vi.fn(async () => {}),
    };
    let dispose: (() => void | Promise<void>) | undefined;
    let capability: BootDiagnosticsCapability | undefined;
    await plugin.activate({
      get: () => storage,
      effect: async (install: () => () => void | Promise<void>) => {
        dispose = install();
        return dispose;
      },
      provide: (_id: string, value: unknown) => {
        capability = value as BootDiagnosticsCapability;
        return () => {};
      },
    } as never);
    const diagnostic: BootDiagnostic = {
      requestedProfileId: "broken.user",
      recoveryProfileId: "termco.safe-recovery",
      phase: "profile-boot",
      message: "plugin failed",
      at: "2026-08-21T00:00:00.000Z",
    };
    await capability?.record(diagnostic);
    await expect(capability?.read()).resolves.toEqual(diagnostic);
    await capability?.clear();
    await expect(capability?.read()).resolves.toBeNull();
    expect(handle.save).toHaveBeenCalledTimes(2);
    expect(storage.close).not.toHaveBeenCalled();
    await dispose?.();
    expect(storage.close).toHaveBeenCalledWith("termco-boot-diagnostics.json");
  });
});

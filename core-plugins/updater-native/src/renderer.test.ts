import type { ApplicationInfoCapability, ApplicationUpdatesCapability } from "@termco/application-base";
import type { DesktopIntegrationCapability } from "@termco/desktop-base";
import {
  EVENTS_APPLICATION_SERVICE,
  type ApplicationEventsCapability,
} from "@termco/events-base";
import type { HttpCapability } from "@termco/http-base";
import type { UiOverlayRegistry } from "@termco/ui-overlays-base";
import { describe, expect, it, vi } from "vitest";
import plugin from "./renderer";

describe("updater renderer entry", () => {
  it("publishes the complete updater as an overlay contribution", async () => {
    const capabilities = new Map<string, unknown>([
      [
        "application.info",
        {
          getInfo: async () => ({
            name: "Termco",
            version: "1.0.0",
            bundleId: "dev.termco",
            platform: "darwin",
            architecture: "arm64",
          }),
        } satisfies ApplicationInfoCapability,
      ],
      [
        "application.updates",
        {
          check: async () => null,
          downloadAndInstall: async () => {},
          install: () => {},
        } satisfies ApplicationUpdatesCapability,
      ],
      [
        EVENTS_APPLICATION_SERVICE,
        {
          emit: () => {},
          subscribe: () => () => {},
          subscribeAll: () => () => {},
          listenerCount: () => 0,
        } satisfies ApplicationEventsCapability,
      ],
      ["desktop.integration", {} as DesktopIntegrationCapability],
      ["network.http", {} as HttpCapability],
    ]);
    const register = vi.fn(() => () => {});
    capabilities.set("ui.overlays", {
      register,
      snapshot: () => [],
      records: () => [],
      subscribe: () => () => {},
    } satisfies UiOverlayRegistry);
    const provide = vi.fn();
    const disposers: Array<() => void | Promise<void>> = [];
    await plugin.activate({
      get: (id: string) => capabilities.get(id),
      provide,
      effect: async (install: () => (() => void | Promise<void>) | Promise<() => void | Promise<void>>) => {
        const dispose = await install();
        disposers.push(dispose);
        return dispose;
      },
    } as never);

    expect(provide).toHaveBeenCalledWith(
      "application.update-state",
      expect.objectContaining({
        snapshot: expect.any(Function),
        subscribe: expect.any(Function),
        check: expect.any(Function),
        install: expect.any(Function),
      }),
    );
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "updater",
        label: "Software update",
        Component: expect.any(Function),
      }),
      { pluginId: "updater-native", key: "updater" },
    );
    await Promise.all(disposers.reverse().map((dispose) => dispose()));
  });
});

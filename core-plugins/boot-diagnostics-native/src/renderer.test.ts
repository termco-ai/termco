// @vitest-environment node
import {
  APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
  type BootDiagnosticsCapability,
} from "@termco/application-base";
import { processTransportService, type ProcessTransport } from "@termco/kernel";
import { describe, expect, it, vi } from "vitest";
import plugin from "./renderer";

describe("boot diagnostics renderer bridge", () => {
  it("projects the selected main provider through the generic process transport", async () => {
    const diagnostic = {
      requestedProfileId: "broken.user",
      recoveryProfileId: "termco.safe-recovery",
      phase: "profile-boot" as const,
      message: "plugin failed",
      at: "2026-08-21T00:00:00.000Z",
    };
    const transport = {
      call: vi.fn(async () => diagnostic),
      registerChannel: vi.fn(),
      releaseChannel: vi.fn(),
      releaseRemote: vi.fn(),
    } as unknown as ProcessTransport;
    let capability: BootDiagnosticsCapability | undefined;

    await plugin.activate({
      get: (service: string) => {
        expect(service).toBe(processTransportService);
        return transport;
      },
      effect: vi.fn(),
      provide: (service: string, value: unknown) => {
        expect(service).toBe(APPLICATION_BOOT_DIAGNOSTICS_SERVICE);
        capability = value as BootDiagnosticsCapability;
        return () => {};
      },
    } as never);

    await expect(capability?.read()).resolves.toEqual(diagnostic);
    expect(transport.call).toHaveBeenCalledExactlyOnceWith(
      APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
      "read",
      [],
    );
  });
});

// @vitest-environment jsdom
import type {
  BootDiagnosticsCapability,
} from "@termco/application-base";
import type {
  PluginProfileApi,
} from "@termco/profile-base";
import type {
  UiSettingsViewCapability,
} from "@termco/ui-settings-base";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeRecoveryNotice } from "./renderer";

afterEach(cleanup);

describe("safe recovery notice", () => {
  it("explains the failed profile and opens the real Plugin Manager", async () => {
    const diagnostics: BootDiagnosticsCapability = {
      read: vi.fn(async () => ({
        requestedProfileId: "broken.user",
        recoveryProfileId: "termco.safe-recovery",
        phase: "profile-boot" as const,
        message: "candidate activation failed in broken-plugin",
        at: "2026-08-21T00:00:00.000Z",
      })),
      record: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    const settings = {
      show: vi.fn(),
    } as unknown as UiSettingsViewCapability;
    const profile = {
      activate: vi.fn(async () => ({
        status: "replaced" as const,
        profileId: "termco.user.recovered",
      })),
    } as unknown as PluginProfileApi;
    render(
      <SafeRecoveryNotice
        diagnostics={diagnostics}
        settings={settings}
        profile={profile}
      />,
    );
    expect(await screen.findByText(/broken\.user/)).toBeDefined();
    expect(screen.getByText(/candidate activation failed/)).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Plugin Manager" }),
    );
    expect(settings.show).toHaveBeenCalledWith("plugins");
    fireEvent.click(
      screen.getByRole("button", { name: "Restore Default Profile" }),
    );
    expect(profile.activate).toHaveBeenCalledWith("termco.default");
  });
});

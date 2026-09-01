import {
  APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
  type BootDiagnostic,
  type BootDiagnosticsCapability,
} from "@termco/application-base";
import type { PluginModule } from "@termco/kernel";
import {
  PROFILE_TRANSACTIONS_SERVICE,
  type PluginProfileApi,
} from "@termco/profile-base";
import {
  UI_OVERLAYS_SERVICE,
  type UiOverlayContribution,
  type UiOverlayRegistry,
} from "@termco/ui-overlays-base";
import {
  UI_SETTINGS_VIEW_SERVICE,
  type UiSettingsViewCapability,
} from "@termco/ui-settings-base";
import { useEffect, useState } from "react";

export function SafeRecoveryNotice({
  diagnostics,
  settings,
  profile,
}: {
  diagnostics: BootDiagnosticsCapability;
  settings: UiSettingsViewCapability;
  profile: PluginProfileApi;
}) {
  const [diagnostic, setDiagnostic] = useState<BootDiagnostic | null>(null);
  useEffect(() => {
    let active = true;
    void diagnostics.read().then((value) => {
      if (active) setDiagnostic(value);
    });
    return () => {
      active = false;
    };
  }, [diagnostics]);
  if (!diagnostic) return null;
  return (
    <section
      role="alert"
      data-testid="safe-profile-recovery"
      className="fixed left-1/2 top-3 z-[100] w-[min(680px,calc(100vw-24px))] -translate-x-1/2 rounded-lg border border-destructive/40 bg-background p-3 shadow-xl"
    >
      <div className="text-sm font-semibold text-foreground">
        Recovery profile is active
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Profile <code>{diagnostic.requestedProfileId}</code> could not start.
      </p>
      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px] text-foreground">
        {diagnostic.message}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          onClick={() => void profile.activate("termco.default")}
        >
          Restore Default Profile
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground"
          onClick={() => settings.show("plugins")}
        >
          Open Plugin Manager
        </button>
      </div>
    </section>
  );
}

const plugin: PluginModule = {
  inject: [
    PROFILE_TRANSACTIONS_SERVICE,
    UI_OVERLAYS_SERVICE,
    APPLICATION_BOOT_DIAGNOSTICS_SERVICE,
    UI_SETTINGS_VIEW_SERVICE,
  ],
  async activate(context) {
    const diagnostics = context.get<BootDiagnosticsCapability>(
      "application.boot-diagnostics",
    );
    const settings = context.get<UiSettingsViewCapability>("ui.settings-view");
    const profile = context.get<PluginProfileApi>(
      PROFILE_TRANSACTIONS_SERVICE,
    );
    const contribution: UiOverlayContribution = {
      id: "safe-profile-recovery",
      label: "Safe profile recovery",
      description: "Actionable recovery notice for a failed startup profile.",
      order: -1000,
      Component: () => (
        <SafeRecoveryNotice
          diagnostics={diagnostics}
          settings={settings}
          profile={profile}
        />
      ),
    };
    await context.effect(() =>
      context.get<UiOverlayRegistry>(UI_OVERLAYS_SERVICE).register(
        contribution,
        { pluginId: "safe-recovery-native", generation: context.generation, key: contribution.id },
      ),
    );
  },
};

export default plugin;

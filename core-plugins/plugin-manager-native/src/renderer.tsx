import {
  APPLICATION_PATHS_SERVICE,
  type ApplicationPaths,
  type ApplicationPathsCapability,
} from "@termco/application-base";
import {
  DESKTOP_INTEGRATION_SERVICE,
  type DesktopIntegrationCapability,
} from "@termco/desktop-base";
import {
  type PluginModule,
  type ProcessTransport,
  processTransportService,
} from "@termco/kernel";
import {
  contributeOnboarding,
  ONBOARDING_REGISTRY_SERVICE,
  ONBOARDING_RUNTIME_SERVICE,
  type OnboardingRuntime,
} from "@termco/onboarding-base";
import {
  PLUGIN_CATALOG_SERVICE,
  PROFILE_CATALOG_SERVICE,
  PROFILE_TRANSACTIONS_SERVICE,
  type PluginCatalogItem,
  type PluginCatalogStatus,
  type PluginDisableImpact,
  type PluginDraftItem,
  type PluginCreationTarget,
  type PluginProfileApi,
  type ProfileManagementSnapshot,
} from "@termco/profile-base";
import {
  UI_SETTINGS_SECTIONS_SERVICE,
  UI_SETTINGS_VIEW_SERVICE,
  type UiSettingsSectionContribution,
  type UiSettingsSectionRegistry,
  type UiSettingsViewCapability,
} from "@termco/ui-settings-base";
import ui from "@termco/ui";
import {
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  FolderOpenIcon,
  InformationCircleIcon,
  PackageIcon,
  RefreshIcon,
  Search01Icon,
  Tick02Icon,
  Upload04Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  groupedCatalog,
  matchesPlugin,
  pluginSearchEntries,
} from "./catalog";
import {
  createProfileServices,
  type ManagedPluginCatalogItem,
  type ManagedPluginProfileApi,
} from "./profileServices";
import { createPluginManagerOnboardingContribution } from "./onboarding";

const { Button } = ui;
const { useEffect, useMemo, useState, useSyncExternalStore } = ui.React;
type UiNode = Parameters<typeof ui.React.Children.toArray>[0];

const quietAction =
  "termco-focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45";
const outlinedAction =
  "termco-focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45";

type PluginStatusFilter = "all" | PluginCatalogStatus;
const STATUS_FILTERS: readonly {
  value: PluginStatusFilter;
  label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "active-reduced", label: "Reduced" },
  { value: "blocked", label: "Blocked" },
  { value: "failed", label: "Failed" },
  { value: "disabled", label: "Inactive" },
];

function catalogStatus(plugin: ManagedPluginCatalogItem): PluginCatalogStatus {
  return plugin.status ?? (plugin.enabled === false ? "disabled" : "active");
}

function PluginDetails({ plugin }: { plugin: ManagedPluginCatalogItem }) {
  return (
    <div className="mt-3 grid gap-3 border-t border-border/70 pt-3 text-xs">
      <div>
        <div className="termco-section-label mb-1">Source</div>
        <code className="break-all rounded bg-accent px-1.5 py-0.5">
          {plugin.sourceFolder}
        </code>
      </div>
      {plugin.runtime?.length ? (
        <div>
          <div className="termco-section-label mb-1.5">Runtime</div>
          <ul className="m-0 space-y-1 pl-4">
            {plugin.runtime.map((runtime) => (
              <li key={runtime.process}>
                <code>{runtime.process}</code>: {runtime.state}
                {runtime.missingServices.length
                  ? ` — missing ${runtime.missingServices.join(", ")}`
                  : ""}
                {runtime.features.filter((feature) => feature.state !== "active").map(
                  (feature) => `; ${feature.label}: ${feature.state}`,
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="m-0 text-muted-foreground">{plugin.whyLoaded}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="termco-section-label mb-1.5">Provides</div>
          {plugin.provides.length ? (
            <ul className="m-0 space-y-1 pl-4">
              {plugin.provides.map((capability) => (
                <li key={`${capability.id}:${capability.key ?? ""}`}>
                  <code>{capability.id}</code>
                  <span className="text-muted-foreground">
                    {` — ${capability.description}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">No capabilities.</span>
          )}
        </div>
        <div>
          <div className="termco-section-label mb-1.5">Uses</div>
          {plugin.consumes.length ? (
            <ul className="m-0 space-y-1 pl-4">
              {plugin.consumes.map((capability) => (
                <li key={capability.id}>
                  <code>{capability.id}</code>
                  <span className="text-muted-foreground">
                    {` — ${capability.description}`}
                    {capability.providers.length
                      ? ` Provider: ${capability.providers.join(", ")}.`
                      : capability.optional
                        ? " Optional."
                        : " Missing provider."}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">No dependencies.</span>
          )}
        </div>
      </div>
      <div>
        <span className="termco-section-label mr-2">Permissions</span>
        <span className="text-muted-foreground">
          {plugin.permissions.join(", ") || "None"}
        </span>
      </div>
    </div>
  );
}

function PluginRow({
  plugin,
  profile,
  installed,
  onDraftChange,
}: {
  plugin: ManagedPluginCatalogItem;
  profile: ManagedPluginProfileApi;
  installed: boolean;
  onDraftChange?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState<
    "copy" | "open" | "apply" | "uninstall" | "toggle" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingImpact, setPendingImpact] =
    useState<PluginDisableImpact | null>(null);

  const copy = async () => {
    const replacementId = window.prompt(
      "New plugin id (the complete source folder will be copied):",
      `${plugin.id}.custom`,
    )?.trim();
    if (!replacementId) return;
    setBusy("copy");
    setMessage(null);
    try {
      const target = (plugin.provides.find((entry) =>
        entry.id.startsWith("ui.")
      )?.id ?? (plugin.processes.includes("main")
        ? "main-provider"
        : "renderer-provider")) as PluginCreationTarget;
      const plan = await profile.plan({
        intent: "fork",
        plugin: {
          id: replacementId,
          name: `${plugin.name} Fork`,
          description: plugin.description,
          category: plugin.category,
        },
        sourcePluginId: plugin.id,
        target,
        contributions: [],
        reveal: "none",
      });
      const result = await profile.fork(plan.planId);
      setMessage(
        result.status === "cancelled"
          ? "Fork cancelled; the source plugin is unchanged."
          : `${result.pluginId} was prepared as an independent draft outside the active profile. Edit it, then apply it when ready. Source: ${result.sourceFolder}`,
      );
      if (result.status === "forked") onDraftChange?.();
    } catch (error) {
      setMessage(
        `Fork failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const openSourceFolder = async () => {
    setBusy("open");
    setMessage(null);
    try {
      await profile.openPluginFolder(plugin.id);
    } catch (error) {
      setMessage(
        `Could not open the plugin folder: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy("apply");
    setMessage(null);
    try {
      const result = await profile.apply(plugin.id);
      setMessage(
        result.status === "cancelled"
          ? "Apply cancelled; the current generation remains active."
          : `${result.pluginId} edits are active.`,
      );
    } catch (error) {
      setMessage(
        `Apply failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async () => {
    setBusy("uninstall");
    setMessage(null);
    try {
      const result = await profile.uninstall(plugin.id);
      if (result.status === "cancelled") {
        setMessage("Uninstall cancelled; the plugin remains active.");
      } else if (result.warning) {
        setMessage(result.warning.message);
      }
    } catch (error) {
      setMessage(
        `Uninstall failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const commitToggle = async (impact: PluginDisableImpact) => {
    setBusy("toggle");
    setMessage(null);
    try {
      const result = await profile.setEnabled(plugin.id, impact.enabled, {
        previewId: impact.previewId,
        generation: impact.generation,
      });
      setPendingImpact(null);
      if (result.status === "cancelled") {
        setMessage(
          `${impact.enabled ? "Activation" : "Deactivation"} cancelled; the current plugin state was preserved.`,
        );
      } else if (result.warning) {
        setMessage(result.warning.message);
      }
    } catch (error) {
      setMessage(
        `${impact.enabled ? "Activation" : "Deactivation"} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setBusy(null);
    }
  };

  const toggle = async () => {
    const nextEnabled = plugin.enabled === false;
    setBusy("toggle");
    setMessage(null);
    setPendingImpact(null);
    try {
      const impact = await profile.previewSetEnabled(plugin.id, nextEnabled);
      if (nextEnabled) await commitToggle(impact);
      else setPendingImpact(impact);
    } catch (error) {
      setMessage(
        `Could not preview ${nextEnabled ? "activation" : "deactivation"}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setBusy(null);
    }
  };

  const enabled = plugin.enabled !== false;
  const status = plugin.status ?? (enabled ? "active" : "disabled");
  const statusLabel = {
    active: "Active",
    "active-reduced": "Active with reduced functionality",
    blocked: "Blocked",
    failed: "Failed",
    disabled: "Inactive",
  }[status];

  return (
    <article
      data-testid={`profile-plugin-row-${plugin.id}`}
      className="border-t border-border/70 px-4 py-4 first:border-t-0 hover:bg-accent/25"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-sm font-medium text-foreground">
              {plugin.name}
            </span>
            <code className="text-[11px] font-normal text-muted-foreground/65">
              {plugin.id}
            </code>
          </div>
          <p className="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
            {plugin.description}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground/80">
            <span>v{plugin.version}</span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{plugin.profileRelation ?? (installed ? "installed" : "inherited")}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`size-1.5 rounded-full ${
                  status === "active"
                    ? "bg-primary"
                    : status === "failed"
                      ? "bg-destructive"
                      : status === "blocked" || status === "active-reduced"
                        ? "bg-amber-500"
                        : "bg-muted-foreground/45"
                }`}
              />
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
          <button
            type="button"
            data-testid={`profile-plugin-open-folder-${plugin.id}`}
            className={quietAction}
            disabled={busy !== null}
            onClick={() => void openSourceFolder()}
          >
            <HugeiconsIcon icon={FolderOpenIcon} size={13} strokeWidth={1.9} />
            {busy === "open" ? "Opening…" : "Open folder"}
          </button>
          {installed && (
            <button
              type="button"
              data-testid={`profile-plugin-apply-${plugin.id}`}
              className={outlinedAction}
              disabled={busy !== null}
              onClick={() => void apply()}
            >
              <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.9} />
              {busy === "apply" ? "Applying…" : "Apply edits"}
            </button>
          )}
          <button
            type="button"
            data-testid={`profile-plugin-copy-${plugin.id}`}
            className={quietAction}
            disabled={busy !== null}
            onClick={() => void copy()}
          >
            <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.9} />
            {busy === "copy" ? "Preparing…" : "Fork"}
          </button>
          <button
            type="button"
            data-testid={`profile-plugin-details-${plugin.id}`}
            className={quietAction}
            aria-expanded={details}
            onClick={() => setDetails((value) => !value)}
          >
            <HugeiconsIcon icon={InformationCircleIcon} size={13} strokeWidth={1.9} />
            {details ? "Hide" : "Details"}
          </button>
          {installed ? (
            <button
              type="button"
              data-testid={`profile-plugin-uninstall-${plugin.id}`}
              className={`${quietAction} hover:text-destructive`}
              disabled={busy !== null}
              onClick={() => void uninstall()}
            >
              <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.9} />
              {busy === "uninstall" ? "Removing…" : "Uninstall"}
            </button>
          ) : null}
          <button
            type="button"
            data-testid={`profile-plugin-toggle-${plugin.id}`}
            className={outlinedAction}
            title={plugin.essentialReason}
            disabled={busy !== null || Boolean(plugin.essentialReason)}
            onClick={() => void toggle()}
          >
            {busy === "toggle"
              ? "Applying…"
              : enabled
                ? "Deactivate"
                : "Activate"}
          </button>
        </div>
      </div>

      {message ? (
        <p
          role="status"
          className="mt-3 mb-0 rounded-md border border-border/70 bg-accent/35 px-3 py-2 text-xs text-foreground"
        >
          {message}
        </p>
      ) : null}
      {pendingImpact ? (
        <div
          role="alert"
          data-testid={`profile-plugin-impact-${plugin.id}`}
          className="mt-3 rounded-md border border-border bg-background p-3 text-xs"
        >
          <div className="font-medium text-foreground">
            Deactivate {plugin.name}?
          </div>
          <p className="mt-1 mb-0 text-muted-foreground">
            The plugin itself will be disabled. Other plugins remain selected;
            only the dependent parts below become unavailable until it is
            activated again.
          </p>
          {pendingImpact.blockedPlugins.length ? (
            <div className="mt-3">
              <div className="termco-section-label">Plugins that cannot start</div>
              <ul className="mt-1 mb-0 space-y-1 pl-4">
                {pendingImpact.blockedPlugins.map((affected) => (
                  <li key={affected.pluginId}>
                    <code>{affected.pluginId}</code>
                    <span className="text-muted-foreground">
                      {` — missing ${affected.missingServices.join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pendingImpact.unavailableFeatures.length ? (
            <div className="mt-3">
              <div className="termco-section-label">Features that will hide or pause</div>
              <ul className="mt-1 mb-0 space-y-1 pl-4">
                {pendingImpact.unavailableFeatures.map((feature) => (
                  <li key={`${feature.pluginId}:${feature.featureId}`}>
                    <span>{feature.label}</span>{" "}
                    <code className="text-muted-foreground">({feature.pluginId})</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pendingImpact.degradedPlugins.length ? (
            <div className="mt-3">
              <div className="termco-section-label">Reduced functionality</div>
              <ul className="mt-1 mb-0 space-y-1 pl-4">
                {pendingImpact.degradedPlugins.map((affected) => (
                  <li key={affected.pluginId}>
                    <code>{affected.pluginId}</code>
                    <span className="text-muted-foreground">
                      {` — optional ${affected.optionalServices.join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {pendingImpact.destructiveResources.length ? (
            <div className="mt-3">
              <div className="termco-section-label">Live resources that will stop</div>
              <ul className="mt-1 mb-0 space-y-1 pl-4">
                {pendingImpact.destructiveResources.map((impact) => (
                  <li key={`${impact.capability}:${impact.resourceLabel}`}>
                    {impact.resourceLabel}: {impact.resources
                      .map((resource) => resource.label)
                      .join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!pendingImpact.blockedPlugins.length &&
          !pendingImpact.unavailableFeatures.length &&
          !pendingImpact.degradedPlugins.length &&
          !pendingImpact.destructiveResources.length ? (
            <p className="mt-3 mb-0 text-muted-foreground">
              No other active plugin or feature depends on it.
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              className={quietAction}
              disabled={busy !== null}
              onClick={() => setPendingImpact(null)}
            >
              Keep active
            </button>
            <button
              type="button"
              className={`${outlinedAction} text-destructive`}
              disabled={busy !== null}
              onClick={() => void commitToggle(pendingImpact)}
            >
              {busy === "toggle" ? "Deactivating…" : "Deactivate plugin"}
            </button>
          </div>
        </div>
      ) : null}
      {details ? <PluginDetails plugin={plugin} /> : null}
    </article>
  );
}

function DraftRow({
  draft,
  profile,
  onApplied,
}: {
  draft: PluginDraftItem;
  profile: ManagedPluginProfileApi;
  onApplied: () => void;
}) {
  const [busy, setBusy] = useState<"apply" | "open" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const open = async () => {
    setBusy("open");
    setMessage(null);
    try {
      await profile.openPluginFolder(draft.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    setBusy("apply");
    setMessage(null);
    try {
      const result = await profile.apply(draft.id);
      if (result.status === "replaced") onApplied();
      else setMessage("Apply cancelled; the draft remains outside the profile.");
    } catch (error) {
      setMessage(`Apply failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article data-testid={`plugin-draft-${draft.id}`} className="border-t border-border/70 px-4 py-3.5 first:border-t-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium text-foreground">{draft.name}</span>
            <code className="text-[11px] text-muted-foreground/65">{draft.id}</code>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Draft</span>
          </div>
          <p className="mt-1 mb-0 text-xs text-muted-foreground">{draft.description}</p>
          <p className="mt-1 mb-0 text-[11px] text-muted-foreground/75">
            {draft.replaces
              ? `Will replace ${draft.replaces} only when applied.`
              : draft.forkedFrom
                ? `Independent fork of ${draft.forkedFrom}; source remains active.`
                : "Independent plugin; no active profile row yet."}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className={quietAction} disabled={busy !== null} onClick={() => void open()}>
            <HugeiconsIcon icon={FolderOpenIcon} size={13} strokeWidth={1.9} />
            {busy === "open" ? "Opening…" : "Open folder"}
          </button>
          <button type="button" className={outlinedAction} disabled={busy !== null} onClick={() => void apply()}>
            <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.9} />
            {busy === "apply" ? "Applying…" : "Apply draft"}
          </button>
        </div>
      </div>
      {message ? <p role="status" className="mt-2 text-xs text-destructive">{message}</p> : null}
    </article>
  );
}

export function managedPluginFolder(paths: ApplicationPaths): string {
  const root = paths.appConfigDir.replace(/[\\/]+$/, "");
  return `${root}${paths.pathSeparator}plugin-platform${paths.pathSeparator}plugins`;
}

function SettingsCard({ children }: { children: UiNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-control)]">
      {children}
    </div>
  );
}

function SettingsSection({
  label,
  action,
  children,
}: {
  label: UiNode;
  action?: UiNode;
  children: UiNode;
}) {
  return (
    <section>
      {action ? (
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="termco-section-label">{label}</div>
          {action}
        </div>
      ) : (
        <div className="termco-section-label mb-2">{label}</div>
      )}
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

function SettingRow({
  testId,
  title,
  description,
  children,
}: {
  testId?: string;
  title: UiNode;
  description?: UiNode;
  children: UiNode;
}) {
  return (
    <div
      {...(testId ? { "data-testid": testId } : {})}
      className="flex items-center gap-4 border-t border-border px-4 py-(--settings-row-pad) first:border-t-0 hover:bg-accent/35"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description ? (
          <span className="text-xs leading-[1.5] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function createProfileManager(profile: ManagedPluginProfileApi) {
  return function ProfileManager() {
    const [snapshot, setSnapshot] = useState<ProfileManagementSnapshot | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [version, setVersion] = useState("1.0.0");
    const [busy, setBusy] = useState<"load" | "export" | "import" | string | null>("load");
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = async () => {
      try {
        const next = await profile.profileSnapshot();
        setSnapshot(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy((current) => current === "load" ? null : current);
      }
    };
    useEffect(() => {
      let alive = true;
      void profile.profileSnapshot().then((next) => {
        if (alive) setSnapshot(next);
      }).catch((cause) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (alive) setBusy(null);
      });
      return () => { alive = false; };
    }, []);

    const exportPackage = async () => {
      setError(null);
      setMessage(null);
      setBusy("export");
      try {
        const result = await profile.exportProfile({ name, description, version });
        if (result.status === "exported") {
          setMessage(
            `Exported ${result.name} ${result.version} with ${result.pluginCount} plugins (${result.packagedPluginCount} source folders) to ${result.path}`,
          );
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    };

    const importPackage = async () => {
      setError(null);
      setMessage(null);
      setBusy("import");
      try {
        const result = await profile.importProfile();
        if (result.status !== "cancelled") {
          setMessage(
            result.status === "already-installed"
              ? `${result.name} ${result.version} is already installed.`
              : `Imported ${result.name} ${result.version}. Review it below, then activate it when ready.`,
          );
          await refresh();
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    };

    const activate = async (profileId: string) => {
      setError(null);
      setMessage(null);
      setBusy(profileId);
      try {
        const result = await profile.activate(profileId);
        if (result.status === "replaced") {
          setMessage(`Activated ${profileId}.`);
          await refresh();
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    };

    const active = snapshot?.profiles.find((entry) => entry.active);
    return (
      <div className="space-y-6" data-testid="profiles-section">
        <section>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Share the Termco setup that is working now</h2>
              <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
                Name the active profile and export one portable package. Company-plugin source, onboarding, and portable defaults are included automatically.
              </p>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void importPackage()}
              className={outlinedAction}
              data-testid="profile-import"
            >
              <HugeiconsIcon icon={Upload04Icon} size={14} strokeWidth={1.8} />
              {busy === "import" ? "Importing…" : "Import package…"}
            </button>
          </div>
          <div className="grid gap-3 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-control)]">
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 max-[640px]:grid-cols-1">
              <label className="grid gap-1.5 text-xs font-medium">
                Profile name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Acme Developer"
                  data-testid="profile-export-name"
                  className="termco-focus-ring h-9 rounded-md border border-border bg-background px-3 text-sm font-normal outline-none"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                Version
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  aria-label="Profile version"
                  className="termco-focus-ring h-9 rounded-md border border-border bg-background px-3 font-mono text-xs font-normal outline-none"
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-xs font-medium">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Our recommended Termco setup for product development."
                rows={2}
                className="termco-focus-ring resize-none rounded-md border border-border bg-background px-3 py-2 text-sm font-normal outline-none"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <p className="max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
                Included: {active?.pluginCount ?? "active"} plugin selections, complete company-plugin source, plugin onboarding, and portable defaults. Excluded: credentials, workspaces, history, running processes, caches, and onboarding progress.
              </p>
              <button
                type="button"
                disabled={busy !== null || !name.trim() || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)}
                onClick={() => void exportPackage()}
                className="termco-focus-ring inline-flex h-8 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
                data-testid="profile-export"
              >
                <HugeiconsIcon icon={Download04Icon} size={14} strokeWidth={1.8} />
                {busy === "export" ? "Exporting…" : "Export profile…"}
              </button>
            </div>
          </div>
        </section>

        <SettingsSection label="Profiles on this device">
          {busy === "load" && !snapshot ? (
            <SettingRow title="Loading profiles…"><span /></SettingRow>
          ) : snapshot?.profiles.length ? snapshot.profiles.map((entry) => (
            <SettingRow
              key={entry.id}
              testId={`profile-row-${entry.id}`}
              title={
                <span className="flex items-center gap-2">
                  <span>{entry.name}</span>
                  {entry.version ? <span className="font-mono text-[11px] text-muted-foreground">v{entry.version}</span> : null}
                  {entry.active ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                      <HugeiconsIcon icon={Tick02Icon} size={10} strokeWidth={2} /> Active
                    </span>
                  ) : null}
                </span>
              }
              description={`${entry.description} · ${entry.pluginCount} plugins · ${entry.customPluginCount} company source folder${entry.customPluginCount === 1 ? "" : "s"} · ${entry.kind === "imported" ? "Imported revision" : entry.kind === "default" ? "Termco Default" : "Personal derivative"}`}
            >
              {entry.active ? (
                <span className="text-xs text-muted-foreground">Selected</span>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void activate(entry.id)}
                  className={outlinedAction}
                >
                  {busy === entry.id ? "Activating…" : "Activate"}
                </button>
              )}
            </SettingRow>
          )) : (
            <SettingRow title="No profiles available" description="Import a Termco Profile Package to add one."><span /></SettingRow>
          )}
        </SettingsSection>

        {message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  };
}

export function createPluginManager(
  profile: ManagedPluginProfileApi,
  _desktop: DesktopIntegrationCapability,
  _applicationPaths: ApplicationPathsCapability,
) {
  return function PluginManager() {
    const catalog = useSyncExternalStore(
      profile.subscribe,
      profile.catalog,
      profile.catalog,
    );
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<PluginStatusFilter>("all");
    const [folderMessage, setFolderMessage] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<readonly PluginDraftItem[]>([]);
    const [draftRevision, setDraftRevision] = useState(0);
    const refreshDrafts = () => setDraftRevision((value) => value + 1);
    useEffect(() => {
      let alive = true;
      void profile.listDrafts().then((next) => {
        if (alive) setDrafts(next);
      }).catch((error) => {
        if (alive) {
          setFolderMessage(`Could not list plugin drafts: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
      return () => { alive = false; };
    }, [draftRevision]);
    const installedPlugins = useMemo(
      () => catalog.filter((plugin) => plugin.userInstalled),
      [catalog],
    );
    const profilePlugins = useMemo(
      () => catalog.filter((plugin) => !plugin.userInstalled),
      [catalog],
    );
    const searching = query.trim().length > 0;
    const filtering = searching || statusFilter !== "all";
    const matchesStatus = (plugin: ManagedPluginCatalogItem) =>
      statusFilter === "all" || catalogStatus(plugin) === statusFilter;
    const statusCounts = useMemo(() => {
      const counts = new Map<PluginStatusFilter, number>([["all", catalog.length]]);
      for (const plugin of catalog) {
        const status = catalogStatus(plugin);
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
      return counts;
    }, [catalog]);
    const catalogGroups = useMemo(
      () => groupedCatalog(profilePlugins.filter(matchesStatus), query, null),
      [profilePlugins, query, statusFilter],
    );
    const visibleInstalled = useMemo(
      () => installedPlugins.filter((plugin) =>
        matchesStatus(plugin) && matchesPlugin(plugin, query)
      ),
      [installedPlugins, query, statusFilter],
    );
    const visibleSearchCount =
      visibleInstalled.length +
      catalogGroups.reduce((count, group) => count + group.plugins.length, 0);

    const openPluginFolder = async () => {
      setFolderMessage(null);
      try {
        await profile.openPluginsFolder();
      } catch (error) {
        setFolderMessage(
          `Could not open the plugin folder: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    const installFromFolder = async () => {
      setFolderMessage(null);
      try {
        const result = await profile.installFromFolder();
        if (result.status === "installed") {
          setFolderMessage(`${result.pluginId ?? "Plugin"} installed and active.`);
        }
      } catch (error) {
        setFolderMessage(
          `Could not install the plugin: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    return (
      <div className="space-y-6" data-testid="plugins-section">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-2.5 flex text-muted-foreground">
            <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.8} />
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter plugins…"
            aria-label="Filter plugins"
            data-testid="plugin-search"
            className="termco-focus-ring h-8 w-full rounded-md border border-border bg-card pr-3 pl-8 text-xs text-card-foreground outline-none"
          />
        </div>

        <div
          role="group"
          aria-label="Plugin status"
          className="flex flex-wrap items-center gap-1"
        >
          {STATUS_FILTERS.map((filter) => {
            const selected = statusFilter === filter.value;
            const count = statusCounts.get(filter.value) ?? 0;
            return (
              <button
                key={filter.value}
                type="button"
                aria-label={`${filter.label} ${count}`}
                aria-pressed={selected}
                data-testid={`plugin-status-${filter.value}`}
                onClick={() => setStatusFilter(filter.value)}
                className={`termco-focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  selected
                    ? "border-primary/30 bg-[var(--signal-soft)] text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-accent/45 hover:text-foreground"
                }`}
              >
                <span>{filter.label}</span>
                <span className="font-mono text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {filtering && visibleSearchCount === 0 ? (
          <div
            className="py-8 text-center text-sm text-muted-foreground"
            data-testid="plugin-search-empty"
          >
            {searching
              ? statusFilter === "all"
                ? `No plugins match “${query.trim()}”.`
                : `No ${STATUS_FILTERS.find((entry) => entry.value === statusFilter)?.label.toLocaleLowerCase()} plugins match “${query.trim()}”.`
              : `No ${STATUS_FILTERS.find((entry) => entry.value === statusFilter)?.label.toLocaleLowerCase()} plugins in this profile.`}
          </div>
        ) : null}

        {!filtering ? (
          <div className="space-y-6" data-testid="installed-plugins">
            {drafts.length > 0 ? (
              <SettingsSection
                label={
                  <span className="flex items-center gap-2">
                    <span>Prepared drafts</span>
                    <span className="font-normal text-muted-foreground">{drafts.length}</span>
                  </span>
                }
              >
                {drafts.map((draft) => (
                  <DraftRow key={draft.id} draft={draft} profile={profile} onApplied={refreshDrafts} />
                ))}
              </SettingsSection>
            ) : null}
            <SettingsSection
              label={
                <span className="flex items-center gap-2">
                  <span>Installed plugins</span>
                  <span className="font-normal text-muted-foreground">
                    {installedPlugins.length}
                  </span>
                </span>
              }
              action={
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void installFromFolder()}
                  >
                    Install from folder…
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void openPluginFolder()}
                  >
                    Open plugins folder
                  </Button>
                </div>
              }
            >
              {installedPlugins.length === 0 ? (
                <SettingRow
                  title="No plugins installed"
                  description="Choose a plugin folder to install it, or manage the source directly in the plugins directory."
                >
                  <span />
                </SettingRow>
              ) : (
                installedPlugins.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    profile={profile}
                    installed
                    onDraftChange={refreshDrafts}
                  />
                ))
              )}
            </SettingsSection>
          </div>
        ) : (
          visibleInstalled.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              profile={profile}
              installed
              onDraftChange={refreshDrafts}
            />
          ))
        )}

        {folderMessage ? (
          <p role="status" className="-mt-4 text-xs text-muted-foreground">
            {folderMessage}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {filtering
              ? `${visibleSearchCount} matching ${visibleSearchCount === 1 ? "plugin" : "plugins"}`
              : `${catalog.length} plugins in the active profile`}
          </span>
          <span>{catalog.filter((item) => item.enabled === false).length} inactive</span>
        </div>

        {catalogGroups.map((group) => (
          <section
            key={group.category}
            data-testid={`profile-plugin-category-${group.category
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")}`}
          >
            <div className="termco-section-label mb-2 flex items-center gap-2">
              <span>{group.category}</span>
              <span className="font-normal text-muted-foreground">
                {group.plugins.length}
              </span>
            </div>
            <SettingsCard>
              {group.plugins.map((plugin) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  profile={profile}
                  installed={false}
                  onDraftChange={refreshDrafts}
                />
              ))}
            </SettingsCard>
          </section>
        ))}
      </div>
    );
  };
}

const plugin = {
  inject: [
    processTransportService,
    UI_SETTINGS_SECTIONS_SERVICE,
    DESKTOP_INTEGRATION_SERVICE,
    APPLICATION_PATHS_SERVICE,
    UI_SETTINGS_VIEW_SERVICE,
  ],
  optionalInject: [ONBOARDING_REGISTRY_SERVICE, ONBOARDING_RUNTIME_SERVICE],
  async activate(context) {
    const transport = context.get<ProcessTransport>(processTransportService);
    if (!transport.hostControl) {
      throw new Error(
        "plugin-manager-native requires ProcessTransport.hostControl to provide profile services",
      );
    }
    const services = createProfileServices(transport.hostControl);
    await context.effect(() => services.dispose);
    context.provide<PluginProfileApi>(
      PROFILE_CATALOG_SERVICE,
      services.profile,
    );
    context.provide<PluginProfileApi>(
      PROFILE_TRANSACTIONS_SERVICE,
      services.profile,
    );
    context.provide<readonly PluginCatalogItem[]>(
      PLUGIN_CATALOG_SERVICE,
      services.catalog,
    );
    const profile = services.profile;
    const catalog = services.catalog;
    const settingsView = context.get<UiSettingsViewCapability>(UI_SETTINGS_VIEW_SERVICE);
    contributeOnboarding(
      context,
      createPluginManagerOnboardingContribution(settingsView),
      "Plugin and profile guidance",
    );
    context.feature(
      {
        id: "onboarding:settings-context",
        label: "Contextual plugin and profile guidance",
        requires: [ONBOARDING_RUNTIME_SERVICE],
        uiPolicy: "remove",
      },
      (scope) => {
        let sequence = settingsView.snapshot().openSequence;
        return settingsView.subscribe(() => {
          const next = settingsView.snapshot();
          if (next.open && next.openSequence !== sequence) {
            const journeyId = next.requestedSection === "profiles"
              ? "plugin-manager-native.create-profile"
              : next.requestedSection === "plugins"
              ? "plugin-manager-native.understand-and-adapt"
              : null;
            if (journeyId) {
              void scope.get<OnboardingRuntime>(ONBOARDING_RUNTIME_SERVICE)
                .suggest(journeyId);
            }
          }
          sequence = next.openSequence;
        });
      },
    );
    const contribution: UiSettingsSectionContribution = {
      id: "plugins",
      label: "Plugins",
      description: "Install, enable, and inspect plugins.",
      category: "System",
      order: 65,
      icon: PackageIcon,
      Component: createPluginManager(
        profile,
        context.get<DesktopIntegrationCapability>("desktop.integration"),
        context.get<ApplicationPathsCapability>("application.paths"),
      ),
      searchEntries: [
        {
          title: "Plugin catalog",
          description: "Browse plugins by category and purpose.",
          keywords: "extensions capabilities providers installed uninstall",
        },
        {
          title: "Fork plugin",
          description: "Create a complete editable plugin replacement.",
          keywords: "copy clone source live apply",
        },
        ...pluginSearchEntries(catalog),
      ],
    };
    const profilesContribution: UiSettingsSectionContribution = {
      id: "profiles",
      label: "Profiles",
      description: "Name, export, import, and activate portable Termco setups.",
      category: "System",
      order: 64,
      icon: UserGroupIcon,
      Component: createProfileManager(profile),
      searchEntries: [
        {
          title: "Export company profile",
          description: "Name and export the active plugins and company source as a portable package.",
          keywords: "profile package company share zip onboarding defaults",
        },
        {
          title: "Import profile package",
          description: "Validate and install a portable Termco profile revision.",
          keywords: "profile package import activate revision",
        },
      ],
    };
    await context.effect(() =>
      context
        .get<UiSettingsSectionRegistry>(UI_SETTINGS_SECTIONS_SERVICE)
        .register(contribution, {
          pluginId: "plugin-manager-native",
          generation: context.generation,
          key: "plugins",
        }),
    );
    await context.effect(() =>
      context
        .get<UiSettingsSectionRegistry>(UI_SETTINGS_SECTIONS_SERVICE)
        .register(profilesContribution, {
          pluginId: "plugin-manager-native",
          generation: context.generation,
          key: "profiles",
        }),
    );
  },
} satisfies PluginModule;

export default plugin;

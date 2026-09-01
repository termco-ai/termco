import {
  APPLICATION_BRANDING_SERVICE,
  APPLICATION_INFO_SERVICE,
  type ApplicationBrandingCapability,
  type ApplicationInfoCapability,
} from "@termco/application-base";
import type { Dispose, PluginModule } from "@termco/kernel";
import {
  UI_CHANGE_REVEAL_ADAPTERS_SERVICE,
  type UiChangeRevealAdapter,
  type UiChangeRevealAdapterDirectory,
} from "@termco/ui-change-reveal-base";
import {
  UI_SETTINGS_SECTIONS_SERVICE,
  type UiSettingsSectionRegistry,
  type UiSettingsViewCapability,
} from "@termco/ui-settings-base";
import { UI_THEME_SERVICE, type UiThemeCapability } from "@termco/ui-theme-base";
import {
  UI_WORKSPACE_VIEWS_SERVICE,
  type UiWorkspaceViewContribution,
  type UiWorkspaceViewRegistry,
} from "@termco/ui-workspace-base";
import ui from "@termco/ui";
import {
  Cancel01Icon,
  Moon02Icon,
  Search01Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { isUnhandledSettingsEscape } from "./keyboard";
import { orderedSections, searchSections, sectionGroups } from "./model";
import { createSettingsViewState } from "./state";

const {
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} = ui.React;

function createSettingsView(
  state: UiSettingsViewCapability,
  sectionRegistry: UiSettingsSectionRegistry,
  theme: UiThemeCapability,
  application: ApplicationInfoCapability,
  branding: ApplicationBrandingCapability,
) {
  return function SettingsWorkspace() {
    const snapshot = useSyncExternalStore(state.subscribe, state.snapshot, state.snapshot);
    const themeSnapshot = useSyncExternalStore(theme.subscribe, theme.snapshot, theme.snapshot);
    const primary = useSyncExternalStore(
      sectionRegistry.subscribe,
      sectionRegistry.records,
      sectionRegistry.records,
    );
    const [active, setActive] = useState("");
    const [search, setSearch] = useState("");
    const [version, setVersion] = useState("");

    useEffect(() => {
      let alive = true;
      void application.getInfo()
        .then((info) => { if (alive) setVersion(info.version); })
        .catch(() => {});
      return () => { alive = false; };
    }, [application]);
    const sectionRecords = useMemo(
      () => [...primary].sort((left, right) =>
        (left.value.order ?? 0) - (right.value.order ?? 0) ||
        left.value.label.localeCompare(right.value.label)
      ),
      [primary],
    );
    const sections = useMemo(
      () => orderedSections(sectionRecords.map((entry) => entry.value)),
      [sectionRecords],
    );
    const groups = useMemo(() => sectionGroups(sections), [sections]);
    const results = useMemo(() => searchSections(sections, search), [sections, search]);
    useEffect(() => {
      if (!snapshot.open) return;
      const requested = snapshot.requestedSection;
      setActive(
        requested && sections.some((section) => section.id === requested)
          ? requested
          : sections[0]?.id ?? "",
      );
      setSearch("");
    }, [snapshot.openSequence, snapshot.open, snapshot.requestedSection, sections]);
    useEffect(() => {
      if (!snapshot.open) return;
      const keydown = (event: KeyboardEvent) => {
        if (!isUnhandledSettingsEscape(event)) return;
        const target = event.target as HTMLElement | null;
        if (search) {
          event.stopPropagation();
          setSearch("");
          if (target?.tagName === "INPUT") target.blur();
        } else if (!target?.matches("input, textarea")) {
          state.close();
        }
      };
      window.addEventListener("keydown", keydown);
      return () => window.removeEventListener("keydown", keydown);
    }, [search, snapshot.open, state]);
    if (!snapshot.open) return null;

    const selected = sections.find((section) => section.id === active) ?? sections[0];
    const selectedRecord = sectionRecords.find(
      (entry) => entry.value.id === selected?.id,
    );
    const Section = selected?.Component;
    const searching = search.trim().length > 0;
    const dark = themeSnapshot.resolvedMode === "dark";
    const openSection = (id: string) => {
      setActive(id);
      setSearch("");
    };
    const subtitle = searching
      ? "Results across every settings tab."
      : selected
        ? selected.description
        : "No settings sections are available.";

    return (
      <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background">
        <div
          data-testid="settings-view"
          data-source-plugin="settings-native"
          className="termco-workspace flex min-h-0 flex-1 max-[640px]:flex-col [--settings-row-pad:10px]"
        >
        <nav
          aria-label="Settings categories"
          className="termco-panel flex w-60 shrink-0 flex-col border-r border-border/70 max-[640px]:w-full max-[640px]:border-r-0 max-[640px]:border-b"
        >
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 max-[640px]:hidden">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12">
              <img src={branding.logoUrl} alt="" className="size-[18px]" draggable={false} />
            </div>
            <div className="flex min-w-0 flex-col leading-[1.15]">
              <span className="font-heading text-sm font-semibold">Termco</span>
              <span className="text-xs text-muted-foreground">
                Preferences{version ? ` · v${version}` : ""}
              </span>
            </div>
          </div>

          <div className="px-3 pt-1 pb-2.5 max-[640px]:pt-2 max-[640px]:pb-1.5">
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-2.5 flex text-muted-foreground">
                <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.8} />
              </span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search settings…"
                aria-label="Search settings"
                className="termco-focus-ring h-8 w-full rounded-md border border-border bg-card pr-8 pl-8 text-xs text-card-foreground outline-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-1.5 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 max-[640px]:flex max-[640px]:flex-none max-[640px]:gap-1 max-[640px]:overflow-x-auto max-[640px]:pb-2">
            {groups.map((group, groupIndex) => (
              <div
                key={group.label || `group-${groupIndex}`}
                className={`max-[640px]:contents ${groupIndex === 0 ? "" : "mt-3.5"}`}
              >
                {group.label ? (
                  <div className="termco-section-label px-2.5 pt-2 pb-1 max-[640px]:hidden">
                    {group.label}
                  </div>
                ) : null}
                {group.entries.map((entry) => {
                  const current = entry.id === selected?.id && !searching;
                  const owner = sectionRecords.find(
                    (record) => record.value.id === entry.id,
                  );
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      aria-label={entry.label}
                      aria-current={current ? "page" : undefined}
                      data-plugin-owner={owner?.pluginId}
                      data-plugin-generation={owner?.generation}
                      data-contribution-service="ui.settings.sections"
                      data-contribution-key={owner?.key}
                      data-contribution-selected={current ? "true" : "false"}
                      onClick={() => openSection(entry.id)}
                      className={`mt-px flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors max-[640px]:w-auto max-[640px]:shrink-0 ${
                        current
                          ? "bg-primary/12 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {entry.icon ? (
                        <HugeiconsIcon
                          icon={entry.icon as never}
                          size={17}
                          strokeWidth={1.7}
                          className="shrink-0"
                        />
                      ) : null}
                      <span className="flex-1 text-left">{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void theme.mutate({ type: "set-mode", mode: dark ? "light" : "dark" })}
            className="m-3.5 flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-[var(--shadow-control)] transition-colors hover:bg-accent hover:text-foreground max-[640px]:hidden"
          >
            <span className="flex text-primary">
              <HugeiconsIcon icon={dark ? Moon02Icon : Sun03Icon} size={16} strokeWidth={1.8} />
            </span>
            <span className="flex-1 text-left">{dark ? "Dark" : "Light"}</span>
            <span className="text-xs text-muted-foreground/80">
              {themeSnapshot.mode === "system" ? "System" : "Click to flip"}
            </span>
          </button>
        </nav>

        <main className="termco-workspace flex min-w-0 flex-1 flex-col">
          <header className="termco-toolbar flex h-14 shrink-0 items-center gap-3.5 border-b border-border/70 px-6 max-[640px]:px-4">
            <div className="min-w-0 flex-1">
              <h1
                data-plugin-owner={selectedRecord?.pluginId}
                data-plugin-generation={selectedRecord?.generation}
                data-contribution-service="ui.settings.sections"
                data-contribution-key={selectedRecord?.key}
                data-contribution-selected="true"
                className="font-heading text-base font-semibold text-foreground"
              >
                {searching ? "Search" : selected?.label ?? "Settings"}
              </h1>
              {subtitle ? (
                <div className="mt-px truncate text-xs text-muted-foreground">
                  {subtitle}
                </div>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-6 max-[640px]:p-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="mx-auto w-full max-w-[860px]">
              {searching ? (
                results.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    No settings match “{search.trim()}”.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="mb-1 text-xs font-semibold tracking-[0.09em] text-muted-foreground/80 uppercase">
                      {results.length} result{results.length === 1 ? "" : "s"}
                    </div>
                    {results.map((result) => (
                      <button
                        key={`${result.sectionId}:${result.title}`}
                        type="button"
                        onClick={() => openSection(result.sectionId)}
                        className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3.5 py-3 text-left shadow-[var(--shadow-control)] transition-colors hover:border-foreground/25 hover:bg-accent/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm">{result.title}</div>
                          <div className="mt-px truncate text-xs text-muted-foreground">
                            {result.description}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold tracking-[0.04em] text-primary uppercase">
                          {result.sectionLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              ) : Section ? (
                <div
                  data-plugin-owner={selectedRecord?.pluginId}
                  data-plugin-generation={selectedRecord?.generation}
                  data-contribution-service="ui.settings.sections"
                  data-contribution-key={selectedRecord?.key}
                  data-contribution-selected="true"
                >
                  <ui.ErrorBoundary
                    key={selected?.id}
                    fallback={(error) => (
                      <div role="alert" data-testid="settings-section-error" className="rounded-lg border border-destructive p-4">
                        <strong>Section failed</strong><p>{error.message}</p>
                      </div>
                    )}
                  >
                    <Suspense fallback={null}><Section dismiss={state.close} /></Suspense>
                  </ui.ErrorBoundary>
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No settings sections are installed.
                </div>
              )}
            </div>
          </div>
          </main>
        </div>
      </div>
    );
  };
}

const settingsViewState = createSettingsViewState();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      queueMicrotask(resolve);
    }
  });
}

export function createSettingsRevealAdapter(
  state: UiSettingsViewCapability,
  root: Document,
): UiChangeRevealAdapter {
  return {
    id: "settings-section-reveal",
    services: ["ui.settings.sections"],
    async reveal(request) {
      state.show(request.target.key);
      await nextFrame();
      const element = [...root.querySelectorAll<HTMLElement>(
        '[data-contribution-service="ui.settings.sections"]',
      )].find((candidate) =>
        candidate.dataset.pluginOwner === request.target.pluginId &&
        candidate.dataset.pluginGeneration === request.target.generation &&
        candidate.dataset.contributionKey === request.target.key &&
        candidate.matches("h1, h2, h3, [role=heading]")
      );
      return element
        ? {
            status: "revealed",
            target: request.target,
            message: "Settings opened the exact contributed section.",
            element,
          }
        : {
            status: "not-found",
            target: request.target,
            message: "The exact contributed Settings section is no longer mounted.",
          };
    },
  };
}

const fallbackThemeSnapshot = {
  revision: 0,
  mode: "system" as const,
  resolvedMode: "dark" as const,
  themeId: "default",
  themes: [],
  customThemeIds: [],
  editorTheme: "default",
  background: {
    kind: "none" as const,
    imageId: null,
    opacity: 0.5,
    blur: 0,
  },
};

const plugin: PluginModule = {
  inject: [
    UI_SETTINGS_SECTIONS_SERVICE,
    UI_WORKSPACE_VIEWS_SERVICE,
  ],
  optionalInject: [
    UI_CHANGE_REVEAL_ADAPTERS_SERVICE,
    UI_THEME_SERVICE,
    APPLICATION_INFO_SERVICE,
    APPLICATION_BRANDING_SERVICE,
  ],
  async activate(context) {
    const state = settingsViewState;
    const revealAdapter = createSettingsRevealAdapter(state, document);
    await context.effect(() => {
      const observed = context.observe<UiChangeRevealAdapterDirectory>(
        UI_CHANGE_REVEAL_ADAPTERS_SERVICE,
      );
      let disposeRegistration: Dispose | undefined;
      const bind = () => {
        void disposeRegistration?.();
        disposeRegistration = observed.current()?.register(revealAdapter, {
          pluginId: context.pluginId,
          generation: context.generation,
          key: revealAdapter.id,
        });
      };
      const disposeObservation = observed.subscribe(bind);
      bind();
      return async () => {
        await disposeRegistration?.();
        await disposeObservation();
      };
    });
    const sections = context.get<UiSettingsSectionRegistry>(
      UI_SETTINGS_SECTIONS_SERVICE,
    );
    const observedTheme = context.observe<UiThemeCapability>(UI_THEME_SERVICE);
    const observedApplication = context.observe<ApplicationInfoCapability>(
      APPLICATION_INFO_SERVICE,
    );
    const observedBranding = context.observe<ApplicationBrandingCapability>(
      APPLICATION_BRANDING_SERVICE,
    );
    const theme: UiThemeCapability = {
      Root: ({ children }) => children,
      snapshot: () => observedTheme.current()?.snapshot() ?? fallbackThemeSnapshot,
      subscribe(listener) {
        let removeTheme = observedTheme.current()?.subscribe(listener) ?? (() => {});
        const removeAvailability = observedTheme.subscribe(() => {
          removeTheme();
          removeTheme = observedTheme.current()?.subscribe(listener) ?? (() => {});
          listener();
        });
        return () => {
          removeAvailability();
          removeTheme();
        };
      },
      mutate: (mutation) =>
        observedTheme.current()?.mutate(mutation) ?? Promise.resolve({}),
      validate: (raw) =>
        observedTheme.current()?.validate(raw) ?? {
          ok: false,
          error: "Theme provider is unavailable.",
        },
      resolveEditorTheme: (preference) =>
        observedTheme.current()?.resolveEditorTheme(preference) ?? preference,
    };
    const application: ApplicationInfoCapability = {
      getInfo: () =>
        observedApplication.current()?.getInfo() ??
        Promise.resolve({
          name: "Termco",
          version: "",
          bundleId: "",
          platform: "darwin",
          architecture: "",
        }),
    };
    const branding: ApplicationBrandingCapability = {
      get logoUrl() {
        return observedBranding.current()?.logoUrl ?? "";
      },
    };
    const contribution: UiWorkspaceViewContribution = {
      id: "settings",
      label: "Settings",
      description: "Categorized and searchable application settings.",
      order: -10,
      Component: createSettingsView(
        state,
        sections,
        theme,
        application,
        branding,
      ),
    };
    context.provide("ui.settings-view", state);
    await context.effect(() =>
      context.get<UiWorkspaceViewRegistry>(UI_WORKSPACE_VIEWS_SERVICE).register(
        contribution,
        { pluginId: "settings-native", generation: context.generation, key: contribution.id },
      ),
    );
  },
};

export default plugin;

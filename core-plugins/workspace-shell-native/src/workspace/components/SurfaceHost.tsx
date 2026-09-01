import type { Tab } from "../tabs";
import type { ContributionRecord } from "@termco/kernel";
import type {
  UiTabDescriptor,
  UiTabKindContribution,
  UiTabsRuntime,
} from "@termco/ui-tabs-base";
import { ErrorBoundary, cn } from "@termco/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReplaceSearchRegistration } from "../tabSurfaceRuntime";

export type TabSurfaceRuntimeFactory = (
  activeId: number,
  replaceSearchRegistration: ReplaceSearchRegistration,
) => UiTabsRuntime;

export type SurfaceHostProps = {
  tabs: Tab[];
  activeId: number;
  activeTab: Tab | undefined;
  contributions: readonly ContributionRecord<UiTabKindContribution>[];
  createRuntime: TabSurfaceRuntimeFactory;
};

function descriptor(tab: Tab): UiTabDescriptor {
  const { id, rigId, kind, title, cold, ...data } = tab;
  return {
    id,
    rigId,
    kind,
    title,
    cold: Boolean(cold),
    ...("path" in tab && typeof tab.path === "string" ? { path: tab.path } : {}),
    ...("url" in tab && typeof tab.url === "string" ? { url: tab.url } : {}),
    data,
  };
}

function PluginErrorCard({
  pluginId,
  message,
}: {
  pluginId?: string;
  message: string;
}) {
  return (
    <div
      data-testid="plugin-surface-error"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-1.5 p-6 text-center"
    >
      <div className="text-sm font-medium text-foreground">
        Plugin render error
      </div>
      <div className="max-w-sm text-xs text-muted-foreground">
        {pluginId ? (
          <>
            The plugin <code className="rounded bg-accent px-1">{pluginId}</code>{" "}
            crashed while rendering this view.
          </>
        ) : (
          "A plugin crashed while rendering this view."
        )}{" "}
        You can disable it in Settings → Plugins.
      </div>
      <code className="mt-1 max-w-full truncate rounded bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {message}
      </code>
    </div>
  );
}

function SurfaceEntry({
  entry,
  tabs,
  activeId,
  activeTab,
  createRuntime,
}: Omit<SurfaceHostProps, "contributions"> & {
  entry: ContributionRecord<UiTabKindContribution>;
}) {
  const contribution = entry.value;
  const tabsOfKind = tabs.filter((tab) => contribution.kinds.includes(tab.kind));
  const isActive =
    activeTab != null && contribution.kinds.includes(activeTab.kind);
  const searchRegistration = useRef<() => void>(() => {});
  const replaceSearchRegistration = useCallback<ReplaceSearchRegistration>(
    (dispose) => {
      searchRegistration.current();
      searchRegistration.current = dispose;
    },
    [],
  );
  useEffect(
    () => () => {
      searchRegistration.current();
      searchRegistration.current = () => {};
    },
    [],
  );
  const runtime = useMemo(
    () => createRuntime(activeId, replaceSearchRegistration),
    [activeId, createRuntime, replaceSearchRegistration],
  );

  if (
    (contribution.mountWhen ?? "always") === "whenOpen" &&
    tabsOfKind.length === 0
  ) {
    return null;
  }
  const Component = contribution.Component;
  return (
    <div
      data-plugin-owner={entry.pluginId}
      data-plugin-generation={entry.generation}
      data-contribution-service="ui.tabs.kinds"
      data-contribution-key={entry.key}
      className={cn(
        "absolute inset-0",
        !isActive && "invisible pointer-events-none",
      )}
      aria-hidden={!isActive}
    >
      <ErrorBoundary
        fallback={(error) => (
          <PluginErrorCard pluginId={entry.pluginId} message={error.message} />
        )}
      >
        <Component
          tabs={tabs.map(descriptor)}
          activeId={activeId}
          surfaceVisible={contribution.receivesVisibility ? isActive : true}
          runtime={runtime}
        />
      </ErrorBoundary>
    </div>
  );
}

function PluginTabPlaceholder({ kind }: { kind: string }) {
  return (
    <div
      data-testid="plugin-tab-placeholder"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center"
    >
      <div className="text-sm font-medium text-foreground">
        Plugin not active
      </div>
      <div className="max-w-sm text-xs text-muted-foreground">
        This tab belongs to a plugin that is currently disabled or not installed
        ({kind}). Enable the plugin to bring the tab back to life — its content
        is preserved.
      </div>
    </div>
  );
}

export function SurfaceHost(props: SurfaceHostProps) {
  const { contributions, activeTab } = props;
  const activeKindUnclaimed =
    activeTab != null &&
    activeTab.kind.startsWith("plugin:") &&
    !contributions.some(({ value }) => value.kinds.includes(activeTab.kind));
  return (
    <div className="relative h-full min-h-0">
      {activeKindUnclaimed && activeTab ? (
        <PluginTabPlaceholder kind={activeTab.kind} />
      ) : null}
      {contributions.map((entry) => (
        <SurfaceEntry
          key={`${entry.pluginId}:${entry.key}`}
          entry={entry}
          tabs={props.tabs}
          activeId={props.activeId}
          activeTab={props.activeTab}
          createRuntime={props.createRuntime}
        />
      ))}
    </div>
  );
}

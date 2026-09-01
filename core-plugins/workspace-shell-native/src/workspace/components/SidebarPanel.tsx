import type { ContributionRecord } from "@termco/kernel";
import type { UiSidebarViewContribution, UiSidebarViewProps } from "@termco/ui-sidebar-base";
import { ErrorBoundary, ResizablePanel } from "@termco/ui";
import type { ComponentProps, RefObject } from "react";
import {
  SIDEBAR_RAIL_WIDTH,
  SidebarRail,
  type SidebarRailView,
} from "./SidebarRail";

export const SIDEBAR_MIN_WIDTH = 268;
export const SIDEBAR_MAX_WIDTH = 528;

export type SidebarViewEntry = ContributionRecord<UiSidebarViewContribution>;

type Props = {
  sidebarRef: ComponentProps<typeof ResizablePanel>["panelRef"];
  sidebarWidthRef: RefObject<number>;
  initialSidebarCollapsed: boolean;
  persistSidebarWidth: (px: number) => void;
  persistSidebarCollapsed: (collapsed: boolean) => void;
  sidebarView: string;
  persistSidebarView: (view: string) => void;
  views: readonly SidebarViewEntry[];
  viewProps: UiSidebarViewProps;
};

function PluginErrorCard({
  pluginId,
  message,
}: {
  pluginId?: string;
  message: string;
}) {
  return (
    <div
      data-testid="sidebar-panel-error"
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

/**
 * The collapsible left sidebar. The workspace-shell plugin consumes the
 * profile-selected `ui.sidebar.views` contributions directly; no host-owned
 * registry or adapter owns their rendering, badges, order, or lifecycle.
 */
export function SidebarPanel({
  sidebarRef,
  sidebarWidthRef,
  initialSidebarCollapsed,
  persistSidebarWidth,
  persistSidebarCollapsed,
  sidebarView,
  persistSidebarView,
  views,
  viewProps,
}: Props) {
  const ordered = [...views].sort(
    (a, b) => (a.value.order ?? 0) - (b.value.order ?? 0),
  );
  const activeEntry =
    ordered.find((entry) => entry.value.id === sidebarView) ?? ordered[0];
  const activeView = activeEntry?.value;
  const Panel = activeView?.Component;
  const railViews: SidebarRailView[] = ordered.map(({ pluginId, generation, key, value }) => ({
    id: value.id,
    pluginId,
    generation,
    contributionKey: key,
    label: value.label,
    icon: value.icon as SidebarRailView["icon"],
    ...(value.useBadge
      ? {
          badge: () =>
            value.useBadge?.({
              rootPath: viewProps.rootPath,
              workspace: viewProps.workspace,
            }) ?? 0,
        }
      : {}),
  }));

  return (
    <ResizablePanel
      id="sidebar"
      panelRef={sidebarRef}
      defaultSize={
        initialSidebarCollapsed
          ? `${SIDEBAR_RAIL_WIDTH}px`
          : `${sidebarWidthRef.current}px`
      }
      minSize={`${SIDEBAR_MIN_WIDTH}px`}
      maxSize={`${SIDEBAR_MAX_WIDTH}px`}
      collapsible
      collapsedSize={`${SIDEBAR_RAIL_WIDTH}px`}
      onResize={(size) => {
        if (size.inPixels > SIDEBAR_RAIL_WIDTH) {
          persistSidebarWidth(size.inPixels);
        }
        persistSidebarCollapsed(size.inPixels <= SIDEBAR_RAIL_WIDTH);
      }}
    >
      <div className="termco-panel flex h-full min-h-0 border-r border-[var(--hairline-strong)]">
        <SidebarRail
          views={railViews}
          activeView={activeView?.id ?? sidebarView}
          onSelectView={persistSidebarView}
        />
        <div
          key={activeView?.id}
          data-plugin-owner={activeEntry?.pluginId}
          data-plugin-generation={activeEntry?.generation}
          data-contribution-service="ui.sidebar.views"
          data-contribution-key={activeEntry?.key}
          data-contribution-selected="true"
          className="termco-panel termco-panel-in min-h-0 min-w-0 flex-1"
        >
          {Panel ? (
            <ErrorBoundary
              fallback={(error) => (
                <PluginErrorCard
                  pluginId={activeEntry?.pluginId}
                  message={error.message}
                />
              )}
            >
              <Panel {...viewProps} />
            </ErrorBoundary>
          ) : null}
        </div>
      </div>
    </ResizablePanel>
  );
}

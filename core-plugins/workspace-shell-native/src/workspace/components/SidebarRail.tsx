/**
 * The vertical activity rail on the sidebar's left edge: a stack of square
 * icon buttons, one per REGISTERED sidebar view (plugin-rewrite Phase 3 step
 * 3 — the former hardcoded item literal is gone; the host passes the
 * registry's views in rail order).
 *
 * Badges: a view's `badge` is a HOOK (it may subscribe to stores), so each
 * badge renders through a dedicated `RailBadge` component that calls it as
 * `useBadge()` — reactive per item, without the rail knowing the data source.
 *
 * Isolation: every icon button renders inside a `PluginBoundary` — a view
 * whose icon/badge crashes at render degrades to a warn puzzle icon instead
 * of unmounting the rail (and with it the app).
 */
import { ErrorBoundary, cn } from "@termco/ui";
import { PuzzleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export const SIDEBAR_RAIL_WIDTH = 48;

export type SidebarRailView = {
  id: string;
  pluginId: string;
  generation: string;
  contributionKey: string;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  /** Badge hook — called inside `RailBadge`; values <= 0 hide the badge. */
  badge?: () => number;
};

type Props = {
  views: SidebarRailView[];
  activeView: string;
  onSelectView: (view: string) => void;
};

function RailBadge({ useBadge }: { useBadge: () => number }) {
  const value = useBadge();
  if (value <= 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 font-mono text-xs font-semibold leading-none text-primary-foreground tabular-nums">
      {value > 99 ? "99+" : value}
    </span>
  );
}

/** Fallback for a rail item whose render crashed: a warn puzzle icon in the
 * button's footprint, so the rail keeps its rhythm and the rest stays live. */
function BrokenRailItem({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={`${label} — plugin render error`}
      title="Plugin render error"
      data-testid="sidebar-rail-error"
      className="relative flex size-8 items-center justify-center rounded-md text-amber-500"
    >
      <HugeiconsIcon icon={PuzzleIcon} size={16} strokeWidth={1.75} />
    </div>
  );
}

export function SidebarRail({ views, activeView, onSelectView }: Props) {
  return (
    <nav
      aria-label="Workspace tools"
      style={{ width: SIDEBAR_RAIL_WIDTH }}
      className="termco-chrome flex shrink-0 flex-col items-center gap-1 border-r border-border/70 py-2"
    >
      {views.map((view) => {
        const isActive = view.id === activeView;
        return (
          <ErrorBoundary
            key={view.id}
            fallback={() => <BrokenRailItem label={view.label} />}
          >
            <button
              type="button"
              aria-label={view.label}
              aria-pressed={isActive}
              title={view.label}
              data-plugin-owner={view.pluginId}
              data-plugin-generation={view.generation}
              data-contribution-service="ui.sidebar.views"
              data-contribution-key={view.contributionKey}
              data-contribution-selected={isActive ? "true" : "false"}
              onClick={() => onSelectView(view.id)}
              className={cn(
                "relative flex size-8 cursor-pointer items-center justify-center rounded-md outline-none transition-colors duration-[var(--dur-fast)]",
                "focus-visible:ring-2 focus-visible:ring-ring/40",
                isActive
                  ? "bg-primary/12 text-primary before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <HugeiconsIcon
                icon={view.icon}
                size={16}
                strokeWidth={isActive ? 2 : 1.75}
                className="shrink-0 transition-[stroke-width] duration-[var(--dur-base)]"
              />
              {view.badge ? <RailBadge useBadge={view.badge} /> : null}
            </button>
          </ErrorBoundary>
        );
      })}
    </nav>
  );
}

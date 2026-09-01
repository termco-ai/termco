import type { UiDockSurfaceContribution } from "@termco/ui-dock-base";
import type { UiHeaderItemContribution } from "@termco/ui-header-base";
import type { UiOverlayContribution } from "@termco/ui-overlays-base";
import type {
  UiBackgroundContribution,
  UiContributionCapability,
  UiProviderContribution,
  UiShellCapability,
} from "@termco/ui-shell-base";
import type { UiStatusbarItemContribution } from "@termco/ui-statusbar-base";
import type { UiThemeCapability } from "@termco/ui-theme-base";
import type { UiWorkspaceFooterContribution, UiWorkspaceViewContribution } from "@termco/ui-workspace-base";
import type { UiShellContributionStore } from "./registry";

type ReactRuntime = {
  Fragment: unknown;
  createElement(
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
  useSyncExternalStore<T>(
    subscribe: (listener: () => void) => () => void,
    snapshot: () => T,
    serverSnapshot?: () => T,
  ): T;
};

type ShellPrimitives = {
  TooltipProvider: unknown;
  ErrorBoundary: unknown;
  Toaster: unknown;
};

export const UI_CONTRIBUTION_CAPABILITIES = [
  "ui.providers",
  "ui.background.tasks",
  "ui.header.items",
  "ui.statusbar.items",
  "ui.sidebar.views",
  "ui.tabs.kinds",
  "ui.settings.sections",
  "ui.workspace.views",
  "ui.ai-dock.views",
  "ui.dock.surfaces",
  "ui.workspace.footer",
  "ui.overlays",
  "ui.commands",
] as const satisfies readonly UiContributionCapability[];

function ordered<T extends { order?: number }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) =>
    (left.order ?? 0) - (right.order ?? 0),
  );
}

export function createUiShell(
  react: ReactRuntime,
  theme: UiThemeCapability | undefined,
  contributions: UiShellContributionStore,
  primitives: ShellPrimitives,
): UiShellCapability {
  const entries = <T,>(capability: UiContributionCapability) =>
    contributions.entries<T & { id: string }>(capability);
  const renderEntry = (
    entry: {
      pluginId: string;
      generation: string;
      key: string;
      value: { id: string; Component: unknown };
    },
    prefix: string,
    capability: UiContributionCapability,
    componentProps: Record<string, unknown> | null = null,
  ) => react.createElement(
    primitives.ErrorBoundary,
    {
      key: `${prefix}:${entry.pluginId}:${entry.generation}:${entry.key}`,
      owner: entry.pluginId,
      fallback: () => null,
    },
    react.createElement(
      "div",
      {
        style: { display: "contents" },
        "data-plugin-owner": entry.pluginId,
        "data-plugin-generation": entry.generation,
        "data-contribution-service": capability,
        "data-contribution-key": entry.key,
        "data-contribution-mounted": "true",
      },
      react.createElement(entry.value.Component, componentProps),
    ),
  );

  const Notifications = () => {
    const subscribe = (listener: () => void) => theme?.subscribe(listener) ?? (() => {});
    const snapshot = () => theme?.snapshot().resolvedMode ?? "system";
    const resolvedMode = react.useSyncExternalStore(subscribe, snapshot, snapshot);
    return react.createElement(primitives.Toaster, {
      theme: resolvedMode,
      position: "bottom-right",
      className: "toaster group",
      style: {
        "--normal-bg": "var(--card)",
        "--normal-text": "var(--card-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "10px",
      },
      toastOptions: {
        classNames: {
          toast: "border-border/60! text-xs! shadow-lg!",
          success: "[&_[data-icon]]:text-primary",
        },
      },
    });
  };

  const headerRegion = (region: UiHeaderItemContribution["region"]) =>
    ordered(
      entries<UiHeaderItemContribution>("ui.header.items")
        .filter((entry) => entry.value.region === region)
        .map((entry) => ({ ...entry, order: entry.value.order })),
    ).map((entry) => renderEntry(entry, "header", "ui.header.items"));
  const Header = () => {
    const rootItems = headerRegion("root");
    if (rootItems.length > 0) {
      return react.createElement(react.Fragment, null, ...rootItems);
    }
    const titleRow = react.createElement(
      "div",
      {
        "data-drag-region": true,
        style: {
          display: "flex",
          height: 44,
          flexShrink: 0,
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--hairline-strong, var(--border))",
          paddingLeft:
            typeof navigator !== "undefined" &&
            /Mac|iPhone|iPad/.test(navigator.platform)
              ? 80
              : 8,
          paddingRight: 8,
          background: "var(--background)",
        },
      },
      react.createElement("div", { style: { display: "flex", flexShrink: 0, alignItems: "center", gap: 2 } }, ...headerRegion("leading")),
      react.createElement("span", { style: { width: 1, height: 20, flexShrink: 0, background: "var(--border)" } }),
      react.createElement("div", { style: { display: "flex", minWidth: 0, flexShrink: 1, alignItems: "center", gap: 4, overflow: "hidden" } }, ...headerRegion("workspaces")),
      react.createElement("div", { "data-drag-region": true, style: { display: "flex", height: "100%", minWidth: 40, flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" } }, ...headerRegion("center")),
      react.createElement("div", { style: { position: "relative", zIndex: 10, display: "flex", flexShrink: 0, alignItems: "center", gap: 4, height: "100%" } }, ...headerRegion("trailing")),
    );
    const tabRow = react.createElement(
      "div",
      {
        "data-drag-region": true,
        style: {
          display: "flex",
          height: 36,
          flexShrink: 0,
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--border)",
          padding: "0 8px",
          background: "var(--background)",
        },
      },
      ...headerRegion("tabs"),
      react.createElement("div", { "data-drag-region": true, style: { height: "100%", minWidth: 8, flex: 1 } }),
    );
    return react.createElement(
      "div",
      { style: { flexShrink: 0, userSelect: "none" } },
      titleRow,
      tabRow,
    );
  };

  const statusbarSide = (side: UiStatusbarItemContribution["side"]) =>
    ordered(
      entries<UiStatusbarItemContribution>("ui.statusbar.items")
        .filter((entry) => entry.value.side === side)
        .map((entry) => ({ ...entry, order: entry.value.order })),
    );
  const Statusbar = () => {
    const statusbarItems = entries<UiStatusbarItemContribution>(
      "ui.statusbar.items",
    );
    if (statusbarItems.length === 0) return null;
    const renderSide = (side: UiStatusbarItemContribution["side"]) =>
      statusbarSide(side).map((item) =>
        renderEntry(item, "statusbar", "ui.statusbar.items"),
      );
    const root = renderSide("root");
    if (root.length > 0) {
      const leftItems = renderSide("left");
      const rightItems = renderSide("right");
      return react.createElement(
        react.Fragment,
        null,
        ...statusbarSide("root").map((item) =>
          renderEntry(item, "statusbar", "ui.statusbar.items", {
            leftItems,
            rightItems,
          }),
        ),
      );
    }
    return react.createElement(
      "footer",
      {
        "data-testid": "v2-statusbar",
        style: {
          display: "flex",
          height: 28,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderTop: "1px solid var(--border)",
          padding: "0 12px",
          color: "var(--muted-foreground)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          background: "var(--background)",
        },
      },
      react.createElement("div", { style: { display: "flex", minWidth: 0, flex: 1, alignItems: "center", gap: 14 } }, ...renderSide("left")),
      react.createElement("div", { style: { display: "flex", flexShrink: 0, alignItems: "center", gap: 6 } }, ...renderSide("right")),
    );
  };

  const renderContributions = <
    T extends { id: string; order?: number; Component: unknown },
  >(capability: UiContributionCapability, prefix: string) =>
    ordered(
      entries<T>(capability).map((entry) => ({
        ...entry,
        order: entry.value.order,
      })),
    ).map((entry) => renderEntry(entry, prefix, capability));

  const ApplicationLayout = () => {
    const workspace = renderContributions<UiWorkspaceViewContribution>(
      "ui.workspace.views",
      "workspace",
    );
    const footers = renderContributions<UiWorkspaceFooterContribution>(
      "ui.workspace.footer",
      "footer",
    );
    const dock = renderContributions<UiDockSurfaceContribution>(
      "ui.dock.surfaces",
      "dock",
    );
    const overlays = renderContributions<UiOverlayContribution>(
      "ui.overlays",
      "overlay",
    );
    return react.createElement(
      "div",
      {
        "data-testid": "core-shell",
        className:
          "termco-app relative flex h-screen flex-col overflow-hidden text-foreground",
      },
      react.createElement(
        "div",
        { "data-testid": "slot-header", className: "shrink-0" },
        react.createElement(Header, null),
      ),
      react.createElement(
        "main",
        { className: "flex min-h-0 min-w-0 flex-1" },
        react.createElement(
          "div",
          { className: "flex min-h-0 min-w-0 flex-1 flex-col" },
          react.createElement(
            "div",
            {
              "data-testid": "slot-workspace",
              className: "relative flex min-h-0 min-w-0 flex-1 flex-col",
            },
            ...workspace,
          ),
          ...(footers.length > 0
            ? [react.createElement("div", { key: "workspace-footer", "data-testid": "slot-workspace-footer", className: "shrink-0" }, ...footers)]
            : []),
        ),
        ...(dock.length > 0
          ? [react.createElement("div", { key: "dock", "data-testid": "slot-dock", className: "flex shrink-0 flex-col" }, ...dock)]
          : []),
      ),
      react.createElement(
        "div",
        { "data-testid": "slot-statusbar", className: "shrink-0" },
        react.createElement(Statusbar, null),
      ),
      ...(overlays.length > 0
        ? [react.createElement("div", { key: "overlays", "data-testid": "slot-overlays" }, ...overlays)]
        : []),
    );
  };

  const BackgroundTasks = () =>
    react.createElement(
      "div",
      { "data-testid": "slot-background", style: { display: "contents" } },
      ...renderContributions<UiBackgroundContribution>(
        "ui.background.tasks",
        "background",
      ),
    );

  const Root = (() => {
    react.useSyncExternalStore(
      contributions.subscribe,
      contributions.snapshot,
      contributions.snapshot,
    );
    const providers = ordered(
      entries<UiProviderContribution>("ui.providers").map(
        (entry) => entry.value,
      ),
    );
    const layout = providers.reduceRight<unknown>(
      (children, provider) =>
        react.createElement(provider.Component, { key: provider.id }, children),
      react.createElement(ApplicationLayout, null),
    );
    const contents = react.createElement(
      react.Fragment,
      null,
      react.createElement(BackgroundTasks, null),
      react.createElement(primitives.TooltipProvider, null, layout),
      react.createElement(Notifications, null),
    );
    return theme
      ? react.createElement(theme.Root, null, contents)
      : contents;
  }) as UiShellCapability["Root"];

  return { Root };
}

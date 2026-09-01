import {
  UI_COMMANDS_SERVICE,
  type UiCommandContribution,
  type UiCommandRegistry,
} from "@termco/ui-commands-base";
import {
  UI_AI_DOCK_VIEWS_SERVICE,
  UI_DOCK_SURFACES_SERVICE,
  type UiAiDockViewContribution,
  type UiAiDockViewRegistry,
  type UiDockSurfaceContribution,
  type UiDockSurfaceRegistry,
} from "@termco/ui-dock-base";
import {
  UI_HEADER_ITEMS_SERVICE,
  type UiHeaderItemContribution,
  type UiHeaderItemRegistry,
} from "@termco/ui-header-base";
import {
  UI_OVERLAYS_SERVICE,
  type UiOverlayContribution,
  type UiOverlayRegistry,
} from "@termco/ui-overlays-base";
import {
  UI_SETTINGS_SECTIONS_SERVICE,
  type UiSettingsSectionContribution,
  type UiSettingsSectionRegistry,
} from "@termco/ui-settings-base";
import {
  UI_SIDEBAR_VIEWS_SERVICE,
  type UiSidebarViewContribution,
  type UiSidebarViewRegistry,
} from "@termco/ui-sidebar-base";
import {
  UI_BACKGROUND_TASKS_SERVICE,
  UI_CONTRIBUTION_EVIDENCE_SERVICE,
  UI_PROVIDERS_SERVICE,
  type UiBackgroundContribution,
  type UiBackgroundRegistry,
  type UiContributionCapability,
  type UiContributionEvidenceCapability,
  type UiProviderContribution,
  type UiProviderRegistry,
} from "@termco/ui-shell-base";
import {
  UI_STATUSBAR_ITEMS_SERVICE,
  type UiStatusbarItemContribution,
  type UiStatusbarItemRegistry,
} from "@termco/ui-statusbar-base";
import {
  UI_TABS_KINDS_SERVICE,
  type UiTabKindRegistry,
} from "@termco/ui-tabs-base";
import {
  UI_WORKSPACE_FOOTER_SERVICE,
  UI_WORKSPACE_VIEWS_SERVICE,
  type UiWorkspaceFooterContribution,
  type UiWorkspaceFooterRegistry,
  type UiWorkspaceViewContribution,
  type UiWorkspaceViewRegistry,
} from "@termco/ui-workspace-base";
import type { PluginModule } from "@termco/kernel";
import type { Dispose } from "@termco/kernel";
import {
  UI_CHANGE_REVEAL_ADAPTERS_SERVICE,
  type UiChangeRevealAdapterDirectory,
} from "@termco/ui-change-reveal-base";
import ui from "@termco/ui";
import { Toaster } from "sonner";
import {
  type ContributionSource,
  createOrderedRegistry,
  createTabKindRegistry,
  createUiShellContributionStore,
} from "./registry";
import { createUiShell } from "./shell";
import { createContributionEvidence } from "./evidence";
import { createShellRevealAdapter } from "./reveal";

const plugin: PluginModule = {
  replacementPolicy: "unmount-before-dispose",
  optionalInject: [UI_CHANGE_REVEAL_ADAPTERS_SERVICE],
  async activate(context) {
    const commands = createOrderedRegistry<UiCommandContribution>();
    const tabKinds = createTabKindRegistry();
    const settingsSections =
      createOrderedRegistry<UiSettingsSectionContribution>();
    const headerItems = createOrderedRegistry<UiHeaderItemContribution>();
    const statusbarItems = createOrderedRegistry<UiStatusbarItemContribution>();
    const sidebarViews = createOrderedRegistry<UiSidebarViewContribution>();
    const workspaceViews = createOrderedRegistry<UiWorkspaceViewContribution>();
    const aiDockViews = createOrderedRegistry<UiAiDockViewContribution>();
    const overlays = createOrderedRegistry<UiOverlayContribution>();
    const backgroundTasks = createOrderedRegistry<UiBackgroundContribution>();
    const providers = createOrderedRegistry<UiProviderContribution>();
    const dockSurfaces = createOrderedRegistry<UiDockSurfaceContribution>();
    const workspaceFooters =
      createOrderedRegistry<UiWorkspaceFooterContribution>();

    context.provide<UiCommandRegistry>(UI_COMMANDS_SERVICE, commands);
    context.provide<UiTabKindRegistry>(UI_TABS_KINDS_SERVICE, tabKinds);
    context.provide<UiSettingsSectionRegistry>(
      UI_SETTINGS_SECTIONS_SERVICE,
      settingsSections,
    );
    context.provide<UiHeaderItemRegistry>(UI_HEADER_ITEMS_SERVICE, headerItems);
    context.provide<UiStatusbarItemRegistry>(
      UI_STATUSBAR_ITEMS_SERVICE,
      statusbarItems,
    );
    context.provide<UiSidebarViewRegistry>(
      UI_SIDEBAR_VIEWS_SERVICE,
      sidebarViews,
    );
    context.provide<UiWorkspaceViewRegistry>(
      UI_WORKSPACE_VIEWS_SERVICE,
      workspaceViews,
    );
    context.provide<UiAiDockViewRegistry>(
      UI_AI_DOCK_VIEWS_SERVICE,
      aiDockViews,
    );
    context.provide<UiOverlayRegistry>(UI_OVERLAYS_SERVICE, overlays);
    context.provide<UiBackgroundRegistry>(
      UI_BACKGROUND_TASKS_SERVICE,
      backgroundTasks,
    );
    context.provide<UiProviderRegistry>(UI_PROVIDERS_SERVICE, providers);
    context.provide<UiDockSurfaceRegistry>(
      UI_DOCK_SURFACES_SERVICE,
      dockSurfaces,
    );
    context.provide<UiWorkspaceFooterRegistry>(
      UI_WORKSPACE_FOOTER_SERVICE,
      workspaceFooters,
    );

    const sources = new Map<UiContributionCapability, ContributionSource>([
      [UI_COMMANDS_SERVICE, commands],
      [UI_TABS_KINDS_SERVICE, tabKinds],
      [UI_SETTINGS_SECTIONS_SERVICE, settingsSections],
      [UI_HEADER_ITEMS_SERVICE, headerItems],
      [UI_STATUSBAR_ITEMS_SERVICE, statusbarItems],
      [UI_SIDEBAR_VIEWS_SERVICE, sidebarViews],
      [UI_WORKSPACE_VIEWS_SERVICE, workspaceViews],
      [UI_AI_DOCK_VIEWS_SERVICE, aiDockViews],
      [UI_OVERLAYS_SERVICE, overlays],
      [UI_BACKGROUND_TASKS_SERVICE, backgroundTasks],
      [UI_PROVIDERS_SERVICE, providers],
      [UI_DOCK_SURFACES_SERVICE, dockSurfaces],
      [UI_WORKSPACE_FOOTER_SERVICE, workspaceFooters],
    ]);
    const contributions = createUiShellContributionStore(sources);
    await context.effect(() => contributions.dispose);
    context.provide<UiContributionEvidenceCapability>(
      UI_CONTRIBUTION_EVIDENCE_SERVICE,
      createContributionEvidence(contributions, document),
    );
    const revealAdapter = createShellRevealAdapter(document);
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
    context.provide(
      "ui.shell",
      createUiShell(
        ui.React,
        undefined,
        contributions,
        {
          TooltipProvider: ui.TooltipProvider,
          ErrorBoundary: ui.ErrorBoundary,
          Toaster,
        },
      ),
    );
  },
};

export default plugin;

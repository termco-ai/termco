import {
  APPLICATION_INFO_SERVICE,
  APPLICATION_UPDATES_SERVICE,
  type ApplicationInfoCapability,
  type PluginReleaseUpdatesCapability,
  type ApplicationUpdatesCapability,
} from "@termco/application-base";
import { DESKTOP_INTEGRATION_SERVICE, type DesktopIntegrationCapability } from "@termco/desktop-base";
import { EVENTS_APPLICATION_SERVICE, type ApplicationEventsCapability } from "@termco/events-base";
import { NETWORK_HTTP_SERVICE, type HttpCapability } from "@termco/http-base";
import {
  createProcessServiceProxy,
  processTransportService,
  type PluginModule,
  type ProcessTransport,
} from "@termco/kernel";
import {
  UI_OVERLAYS_SERVICE,
  type UiOverlayContribution,
  type UiOverlayRegistry,
} from "@termco/ui-overlays-base";
import { createUpdaterDialog } from "./ui/UpdaterDialog";
import { createUpdaterState } from "./ui/useUpdater";

const plugin: PluginModule = {
  inject: [
    processTransportService,
    APPLICATION_INFO_SERVICE,
    DESKTOP_INTEGRATION_SERVICE,
    EVENTS_APPLICATION_SERVICE,
    NETWORK_HTTP_SERVICE,
    UI_OVERLAYS_SERVICE,
  ],
  async activate(context) {
    const transport = context.get<ProcessTransport>(processTransportService);
    const updates = createProcessServiceProxy<ApplicationUpdatesCapability>(
      APPLICATION_UPDATES_SERVICE,
      transport,
    );
    const pluginUpdates: PluginReleaseUpdatesCapability | undefined =
      transport?.hostControl?.checkPluginReleases &&
      transport.hostControl.installPluginRelease
        ? {
            check: async () =>
              (await transport.hostControl?.checkPluginReleases?.()) as Awaited<
                ReturnType<PluginReleaseUpdatesCapability["check"]>
              >,
            install: async (releaseId) =>
              (await transport.hostControl?.installPluginRelease?.(
                releaseId,
              )) as Awaited<
                ReturnType<PluginReleaseUpdatesCapability["install"]>
              >,
          }
        : undefined;
    context.provide(APPLICATION_UPDATES_SERVICE, updates);
    const application = context.get<ApplicationInfoCapability>(
      "application.info",
    );
    const info = await application.getInfo();
    const desktop = context.get<DesktopIntegrationCapability>(
      "desktop.integration",
    );
    const state = createUpdaterState({
      updates,
      events: context.get<ApplicationEventsCapability>(EVENTS_APPLICATION_SERVICE),
      desktop,
      http: context.get<HttpCapability>("network.http"),
      platform: info.platform,
      currentVersion: info.version,
      pluginUpdates,
    });
    await context.effect(() => () => state.dispose());
    const contribution: UiOverlayContribution = {
      id: "updater",
      label: "Software update",
      description:
        "Checks application and plugin releases, then presents verified installation or Linux package instructions.",
      order: 80,
      Component: createUpdaterDialog({
        state,
        desktop,
      }),
    };
    context.provide("application.update-state", state);
    await context.effect(() =>
      context.get<UiOverlayRegistry>(UI_OVERLAYS_SERVICE).register(
        contribution,
        { pluginId: "updater-native", generation: context.generation, key: contribution.id },
      ),
    );
  },
};

export default plugin;

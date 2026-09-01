import { app } from "electron";
import electronUpdater from "electron-updater";
import type { ApplicationUpdatesCapability } from "@termco/application-base";
import { EVENTS_APPLICATION_SERVICE, type ApplicationEventsCapability } from "@termco/events-base";
import type { PluginModule } from "@termco/kernel";
import { toUpdateMetadata } from "./metadata";

const { autoUpdater } = electronUpdater;

const plugin: PluginModule = {
  inject: [
    EVENTS_APPLICATION_SERVICE,
  ],
  async activate(context) {
    const events = context.get<ApplicationEventsCapability>(EVENTS_APPLICATION_SERVICE);
    const previousAutoDownload = autoUpdater.autoDownload;
    const progress = (value: { total: number; delta: number }) => {
      events.emit("updater://progress", {
        event: "Progress",
        data: { contentLength: value.total, chunkLength: value.delta },
      });
    };
    const finished = () => events.emit("updater://progress", { event: "Finished" });
    await context.effect(() => {
      autoUpdater.autoDownload = false;
      autoUpdater.on("download-progress", progress);
      autoUpdater.on("update-downloaded", finished);
      return () => {
        autoUpdater.off("download-progress", progress);
        autoUpdater.off("update-downloaded", finished);
        autoUpdater.autoDownload = previousAutoDownload;
      };
    });

    const capability: ApplicationUpdatesCapability = {
      async check() {
        try {
          const result = await autoUpdater.checkForUpdates();
          return toUpdateMetadata(result?.updateInfo, app.getVersion());
        } catch {
          return null;
        }
      },
      async downloadAndInstall() {
        events.emit("updater://progress", { event: "Started" });
        await autoUpdater.downloadUpdate();
        autoUpdater.quitAndInstall();
      },
      install() {
        autoUpdater.quitAndInstall();
      },
    };
    context.provide("application.updates", capability);
  },
};

export default plugin;

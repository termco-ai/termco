import type {
  ApplicationUpdateStateCapability,
  ApplicationUpdateStatus,
  ApplicationUpdatesCapability,
  PluginReleaseCheckResult,
  PluginReleaseUpdatesCapability,
  PluginUpdateProgress,
} from "@termco/application-base";
import type { DesktopIntegrationCapability } from "@termco/desktop-base";
import type { ApplicationEventsCapability } from "@termco/events-base";
import type { HttpCapability } from "@termco/http-base";
import ui from "@termco/ui";
import { checkLinuxRelease } from "./releaseCheck";
import type { UpdaterProgressEvent } from "./types";

const { useEffect, useSyncExternalStore } = ui.React;

let activeUpdaterStates = 0;

export function updaterStateCount(): number {
  return activeUpdaterStates;
}

export const DISMISSED_PLUGIN_RELEASE_KEY =
  "termco:updater:dismissed-plugin-release";

export interface UpdaterUiDependencies {
  updates: ApplicationUpdatesCapability;
  events: ApplicationEventsCapability;
  desktop: DesktopIntegrationCapability;
  http: HttpCapability;
  platform: NodeJS.Platform;
  currentVersion: string;
  pluginUpdates?: PluginReleaseUpdatesCapability;
}

export interface ApplicationUpdateStateStore
  extends ApplicationUpdateStateCapability {
  dispose(): void;
}

/** One external store per selected updater plugin generation. The dialog and
 * About section consume the same capability instead of each creating private
 * hook state. */
export function createUpdaterState(
  dependencies: UpdaterUiDependencies,
): ApplicationUpdateStateStore {
  activeUpdaterStates += 1;
  let status: ApplicationUpdateStatus = { kind: "idle" };
  let disposed = false;
  let checkPromise: Promise<void> | null = null;
  let installPromise: Promise<void> | null = null;
  let automaticCheckStarted = false;
  let removeProgress: (() => void) | null = null;
  let removePluginProgress: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: ApplicationUpdateStatus) => {
    if (disposed) return;
    status = next;
    for (const listener of listeners) listener();
  };

  const check = (options: { manual?: boolean } = {}): Promise<void> => {
    if (checkPromise) return checkPromise;
    const task = (async () => {
      if (!options.manual) {
        if (automaticCheckStarted) return;
        automaticCheckStarted = true;
      }
      publish({ kind: "checking" });
      try {
        let applicationStatus: ApplicationUpdateStatus;
        if (dependencies.platform === "linux") {
          const info = await checkLinuxRelease(
            dependencies.http,
            dependencies.currentVersion,
          );
          if (info) {
            applicationStatus = { kind: "manual-available", info };
          } else {
            applicationStatus = { kind: "uptodate" };
          }
        } else {
          const update = await dependencies.updates.check();
          applicationStatus = update?.available
            ? { kind: "available", update }
            : { kind: "uptodate" };
        }
        // A complete application release always wins because it establishes
        // the dependency and protected-plugin baseline for every plugin set.
        if (
          applicationStatus.kind === "available" ||
          applicationStatus.kind === "manual-available"
        ) {
          publish(applicationStatus);
          return;
        }
        const pluginStatus = await (dependencies.pluginUpdates?.check() ??
          Promise.resolve<PluginReleaseCheckResult>({ kind: "unconfigured" }));
        if (pluginStatus.kind === "available") {
          const dismissed = localStorage.getItem(
            DISMISSED_PLUGIN_RELEASE_KEY,
          );
          if (!options.manual && dismissed === pluginStatus.release.releaseId) {
            publish({ kind: "idle" });
            return;
          }
          publish({ kind: "plugin-available", release: pluginStatus.release });
          return;
        }
        if (pluginStatus.kind === "blocked") {
          publish({
            kind: "plugin-blocked",
            release: pluginStatus.release,
            reason: pluginStatus.reason,
          });
          return;
        }
        if (pluginStatus.kind === "rolled-back") {
          publish({
            kind: "plugin-rolled-back",
            releaseId: pluginStatus.releaseId,
            reason: pluginStatus.reason,
          });
          return;
        }
        publish({ kind: "uptodate" });
      } catch (error) {
        publish({ kind: "error", message: String(error) });
      }
    })().finally(() => {
      checkPromise = null;
    });
    checkPromise = task;
    return task;
  };

  const install = (): Promise<void> => {
    if (installPromise) return installPromise;
    if (status.kind === "plugin-available") {
      const release = status.release;
      const task = (async () => {
        if (!dependencies.pluginUpdates) {
          publish({ kind: "error", message: "Plugin updater is unavailable." });
          return;
        }
        publish({ kind: "plugin-installing", release });
        removePluginProgress = dependencies.events.subscribe(
          "updater://plugin-progress",
          (payload) => {
            publish({
              kind: "plugin-installing",
              release,
              progress: payload as PluginUpdateProgress,
            });
          },
        );
        try {
          const result = await dependencies.pluginUpdates.install(
            release.releaseId,
          );
          if (result.status === "cancelled") {
            publish({ kind: "plugin-available", release });
            return;
          }
          localStorage.removeItem(DISMISSED_PLUGIN_RELEASE_KEY);
          publish({ kind: "plugin-installed", release: result.release });
        } catch (error) {
          publish({ kind: "error", message: String(error) });
        } finally {
          removePluginProgress?.();
          removePluginProgress = null;
        }
      })().finally(() => {
        installPromise = null;
      });
      installPromise = task;
      return task;
    }
    if (status.kind !== "available") return Promise.resolve();
    const task = (async () => {
      let total: number | null = null;
      let downloaded = 0;
      publish({ kind: "downloading", downloaded: 0, contentLength: null });
      removeProgress = dependencies.events.subscribe(
        "updater://progress",
        (payload) => {
          const event = payload as UpdaterProgressEvent;
          if (event.event === "Started") {
            total = event.data?.contentLength ?? null;
            publish({
              kind: "downloading",
              downloaded: 0,
              contentLength: total,
            });
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            publish({
              kind: "downloading",
              downloaded,
              contentLength: total,
            });
          } else if (event.event === "Finished") {
            publish({ kind: "ready" });
          }
        },
      );
      try {
        await dependencies.updates.downloadAndInstall();
        dependencies.desktop.relaunch();
      } catch (error) {
        publish({ kind: "error", message: String(error) });
      } finally {
        removeProgress?.();
        removeProgress = null;
      }
    })().finally(() => {
      installPromise = null;
    });
    installPromise = task;
    return task;
  };

  return {
    snapshot: () => status,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check,
    install,
    dismiss: () => {
      if (
        status.kind === "plugin-available" ||
        status.kind === "plugin-blocked"
      ) {
        localStorage.setItem(
          DISMISSED_PLUGIN_RELEASE_KEY,
          status.release.releaseId,
        );
      }
      publish({ kind: "idle" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeUpdaterStates -= 1;
      removeProgress?.();
      removeProgress = null;
      removePluginProgress?.();
      removePluginProgress = null;
      listeners.clear();
    },
  };
}

export function createUseUpdater(state: ApplicationUpdateStateCapability) {
  return function useUpdater({ autoCheck = true }: { autoCheck?: boolean } = {}) {
    const status = useSyncExternalStore(
      state.subscribe,
      state.snapshot,
      state.snapshot,
    );
    useEffect(() => {
      if (autoCheck) void state.check();
    }, [autoCheck]);
    return {
      status,
      check: state.check,
      install: state.install,
      dismiss: state.dismiss,
    };
  };
}

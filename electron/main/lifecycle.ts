import type { App } from "electron";

type LifecycleApp = Pick<App, "on" | "exit">;

export type MainLifecycleDependencies = {
  setAppQuitting: () => void;
  disposePluginRuntime: () => void | Promise<void>;
  reportError?: (error: unknown) => void;
};

/**
 * Keep IPC alive until every renderer has been destroyed. Electron emits
 * `before-quit` while BrowserWindows can still execute code; removing invoke
 * handlers there creates a race where their final effects fail with
 * "No handler registered". `will-quit` runs after all windows are closed, so
 * it is the first safe point for capability/runtime teardown.
 */
export function registerMainLifecycle(
  app: LifecycleApp,
  dependencies: MainLifecycleDependencies,
): void {
  let disposed = false;
  let disposing = false;

  app.on("before-quit", () => {
    dependencies.setAppQuitting();
  });

  app.on("will-quit", (event) => {
    if (disposed) return;
    // Electron does not await async will-quit listeners. Keep the main process
    // alive until plugin effects (notably live PTYs) have been disposed, then
    // use app.exit() to finish without re-entering the quit event sequence.
    event.preventDefault();
    if (disposing) return;
    disposing = true;
    void Promise.resolve(dependencies.disposePluginRuntime())
      .catch((error) => {
        dependencies.reportError?.(error);
      })
      .finally(() => {
        disposed = true;
        app.exit(0);
      });
  });
}

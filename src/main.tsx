import "@wterm/dom/src/terminal.css";
import "./styles/globals.css";

import type { DesktopWindowCapability } from "@termco/desktop-base";
import type { PtyCapability } from "@termco/terminal-base";
import ReactDOM from "react-dom/client";
import { FirstLaunchSetup } from "./components/FirstLaunchSetup";
import { installRuntimeModules } from "./core/runtime/registry";
import { renderRendererProfileRoot } from "./core/runtime/renderRendererProfileRoot";
import { USE_CUSTOM_WINDOW_CONTROLS } from "./lib/platform";
import { bridge } from "./native/bridge";
import {
  bootRendererPlugins,
  currentRendererProfile,
  subscribeRendererProfile,
} from "./platform/rendererRuntime";

if (new URLSearchParams(window.location.search).get("liveBrowserLayer") === "1") {
  document.documentElement.dataset.liveBrowserLayer = "true";
}

if (USE_CUSTOM_WINDOW_CONTROLS) {
  document.documentElement.dataset.chrome = "borderless";
}

// Render-instrumentation overlay, opt-in: `VITE_REACT_SCAN=true pnpm dev`.
// Dev-only dynamic import so it never reaches the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true") {
  const { scan } = await import("react-scan");
  scan({ enabled: true });
}

// The selected ui.shell provider owns the complete renderer root. Activate the
// profile before resolving any application-wide capability.
installRuntimeModules();
const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

function selectedDesktopWindow(): DesktopWindowCapability | null {
  try {
    return (
      currentRendererProfile()?.runtime.platformCapability<DesktopWindowCapability>(
        "desktop.window",
      ) ?? null
    );
  } catch {
    return null;
  }
}

const renderActiveProfile = () => {
  const profile = currentRendererProfile();
  if (profile) renderRendererProfileRoot(root, profile);
};
subscribeRendererProfile(() => {
  renderActiveProfile();
});

function startupMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function renderStartupRecovery(
  message: string,
  status: "waiting" | "recovering" | "failed",
  retry?: () => void,
) {
  root.render(
    <main
      data-testid="renderer-startup-recovery"
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
    >
      <section
        role="alert"
        className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-xl"
      >
        <div className="text-base font-semibold">
          The selected profile could not load
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === "failed"
            ? "Automatic recovery also failed. Your profile files were not deleted."
            : "Your data is safe. The app is switching to its protected recovery profile."}
        </p>
        <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
          {message}
        </pre>
        <div className="mt-4 flex items-center gap-3 text-sm">
          {status === "recovering" ? (
            <span data-testid="renderer-startup-recovery-status">
              Recovering…
            </span>
          ) : null}
          {status === "failed" && retry ? (
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground"
              onClick={retry}
            >
              Retry recovery
            </button>
          ) : null}
        </div>
      </section>
    </main>,
  );
}

async function recoverRendererStartup(initialError: unknown): Promise<void> {
  const originalMessage = startupMessage(initialError);
  renderStartupRecovery(originalMessage, "recovering");
  await bridge()
    .windowAction("show")
    .catch(() => undefined);
  try {
    const selected = await bridge().rendererPluginProfile();
    await bridge().recoverRendererProfile({
      requestedProfileId: selected.profileId,
      message: originalMessage,
    });
  } catch (recoveryError) {
    const recoveryMessage = `${originalMessage}\n\nRecovery failed: ${startupMessage(recoveryError)}`;
    renderStartupRecovery(recoveryMessage, "failed", () => {
      void recoverRendererStartup(initialError);
    });
  }
}

async function bootWorkspace(): Promise<void> {
  try {
    const activeRendererProfile = await bootRendererPlugins();
    // Reap sessions orphaned by a prior renderer load before the selected shell
    // mounts. The selected provider owns the one application-wide pool.
    try {
      await activeRendererProfile.runtime
        .platformCapability<PtyCapability>("terminal.pty")
        .closeAll();
    } catch {}
    renderActiveProfile();
  } catch (error) {
    renderStartupRecovery(startupMessage(error), "waiting");
    // Paint a useful explanation first, then recover in the same window. This
    // delay is short enough to feel automatic and long enough to avoid another
    // unexplained flash when the selected profile is broken.
    setTimeout(() => void recoverRendererStartup(error), 750);
  }
}

async function startApplication(): Promise<void> {
  try {
    const bootstrap = await bridge().pluginBootstrapStatus();
    if (bootstrap.kind === "required") {
      root.render(
        <FirstLaunchSetup status={bootstrap} onInstalled={bootWorkspace} />,
      );
      return;
    }
    if (bootstrap.kind === "recovery") {
      renderStartupRecovery(bootstrap.message, "failed", () => {
        void startApplication();
      });
      return;
    }
    await bootWorkspace();
  } catch (error) {
    renderStartupRecovery(startupMessage(error), "failed", () => {
      void startApplication();
    });
  }
}

void startApplication();

// Window starts hidden (created with `show: false`) so users never see a
// transparent shadow-only frame before React paints. Use setTimeout — rAF is throttled
// while the window is hidden and would never fire.
const showWindow = () => {
  const desktop = selectedDesktopWindow();
  const show = desktop ? desktop.show() : bridge().windowAction("show");
  void show.catch((e) => console.error("window.show failed:", e));
};
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);

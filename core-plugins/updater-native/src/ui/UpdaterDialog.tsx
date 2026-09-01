import ui from "@termco/ui";
import type { ApplicationUpdateStateCapability } from "@termco/application-base";
import type { DesktopIntegrationCapability } from "@termco/desktop-base";
import {
  distroCommand,
  formatBytes,
  type DistroKey,
} from "./distroCommand";
import { ManualInstallPanel } from "./ManualInstallPanel";
import { createUseUpdater } from "./useUpdater";

const { Fragment, useState } = ui.React;

export function createUpdaterDialog(
  dependencies: {
    state: ApplicationUpdateStateCapability;
    desktop: DesktopIntegrationCapability;
  },
  useUpdater = createUseUpdater(dependencies.state),
) {

  return function UpdaterDialog() {
    const { status, install, dismiss } = useUpdater();
    const [reviewing, setReviewing] = useState(false);
    const [copied, setCopied] = useState(false);
    const [distro, setDistro] = useState<DistroKey>("arch");
    const dismissUpdater = () => {
      setReviewing(false);
      dismiss();
    };
    const manualVersion =
      status.kind === "manual-available" ? status.info.version : "";
    const activeCommand = distroCommand(distro, manualVersion);

    const reviewable =
      status.kind === "available" ||
      status.kind === "manual-available" ||
      status.kind === "plugin-available";
    const open =
      (reviewable && reviewing) ||
      status.kind === "downloading" ||
      status.kind === "ready" ||
      status.kind === "plugin-installing" ||
      status.kind === "plugin-installed" ||
      status.kind === "plugin-blocked" ||
      status.kind === "plugin-rolled-back";
    if (!open && !reviewable) return null;

    const update = status.kind === "available" ? status.update : null;
    const manual = status.kind === "manual-available" ? status.info : null;
    const applicationNotes = update?.body || manual?.body || "";
    const downloading = status.kind === "downloading";
    const ready = status.kind === "ready";
    const pluginRelease =
      status.kind === "plugin-available" ||
      status.kind === "plugin-installing" ||
      status.kind === "plugin-installed" ||
      status.kind === "plugin-blocked"
        ? status.release
        : null;
    const pluginInstalling = status.kind === "plugin-installing";
    const pluginInstalled = status.kind === "plugin-installed";
    const pluginBlocked = status.kind === "plugin-blocked";
    const pluginRolledBack = status.kind === "plugin-rolled-back";

    const copyCommand = async () => {
      try {
        await Promise.resolve(
          dependencies.desktop.writeClipboardText(activeCommand),
        );
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard failure leaves the existing label unchanged.
      }
    };
    const progress =
      downloading && status.contentLength
        ? Math.min(100, (status.downloaded / status.contentLength) * 100)
        : null;
    const pluginProgress = pluginInstalling ? status.progress : undefined;
    const pluginProgressValue = pluginProgress && pluginProgress.total > 0
      ? Math.min(100, (pluginProgress.completed / pluginProgress.total) * 100)
      : undefined;
    const pluginProgressLabel = (() => {
      if (!pluginProgress) return "Starting the signed update…";
      if (pluginProgress.stage === "downloading") {
        const total = pluginProgress.totalBytes;
        const received = pluginProgress.downloadedBytes ?? pluginProgress.completed;
        return total
          ? `Downloading ${Math.round((received / total) * 100)}% — ${formatBytes(received)}`
          : `Downloading — ${formatBytes(received)}`;
      }
      if (pluginProgress.stage === "verifying") return "Verifying the signed plugin artifact…";
      if (pluginProgress.stage === "activating") return "Activating the new plugin generation…";
      const position = Math.min(pluginProgress.completed + 1, pluginProgress.total);
      return pluginProgress.pluginName
        ? `Preparing ${pluginProgress.pluginName} (${position} of ${pluginProgress.total})`
        : `Prepared ${pluginProgress.completed} of ${pluginProgress.total} plugins`;
    })();

    const bannerTitle = status.kind === "plugin-available"
      ? `${status.release.plugins.length} plugin update${status.release.plugins.length === 1 ? "" : "s"} available`
      : status.kind === "manual-available"
        ? `Termco v${status.info.version} is available`
        : status.kind === "available"
          ? `Termco v${status.update.version} is available`
          : "";

    return (
      <Fragment>
        {reviewable && !reviewing ? (
          <aside
            role="status"
            aria-live="polite"
            className="termco-floating fixed bottom-4 right-4 z-40 flex w-[min(380px,calc(100vw-2rem))] items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{bannerTitle}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Review the details when you are ready.
              </p>
            </div>
            <ui.Button variant="ghost" size="sm" onClick={() => {
              dismissUpdater();
            }}>
              Later
            </ui.Button>
            <ui.Button size="sm" onClick={() => setReviewing(true)}>
              Review
            </ui.Button>
          </aside>
        ) : null}
      <ui.Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (
            !nextOpen &&
            (status.kind === "available" ||
              status.kind === "manual-available" ||
              status.kind === "plugin-available")
          ) {
            setReviewing(false);
          } else if (
            !nextOpen &&
            (status.kind === "plugin-installed" ||
              status.kind === "plugin-blocked" ||
              status.kind === "plugin-rolled-back")
          ) {
            dismissUpdater();
          }
        }}
      >
        <ui.DialogContent className="flex max-h-[min(680px,calc(100vh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]">
          <ui.DialogHeader className="shrink-0 px-6 pb-4 pt-6">
            <ui.DialogTitle>
              {ready
                ? "Update ready"
                : pluginInstalled
                  ? "Plugins updated"
                  : pluginInstalling
                    ? "Updating plugins…"
                    : pluginBlocked
                      ? "Plugin update needs attention"
                      : pluginRolledBack
                        ? "Plugin update rolled back"
                        : pluginRelease
                          ? `${pluginRelease.plugins.length} plugin${pluginRelease.plugins.length === 1 ? "" : "s"} ready to update`
                : downloading
                  ? "Downloading update…"
                  : manual
                    ? `Termco v${manual.version} is available`
                    : `Termco v${update?.version} is available`}
            </ui.DialogTitle>
            <ui.DialogDescription>
              {ready
                ? "Restart Termco to finish installing."
                : pluginInstalled
                  ? "The new plugin generation is active. No application restart was required."
                    : pluginInstalling
                      ? "The signed set is being verified, staged, and activated atomically."
                    : pluginBlocked
                      ? status.reason
                      : pluginRolledBack
                        ? status.reason
                        : pluginRelease
                          ? "Only plugins with real version changes are shown. Personal customizations remain untouched."
                : downloading
                  ? "Termco is downloading and verifying the signed update."
                  : manual
                    ? `You're on v${manual.currentVersion}. Pick your distro and run the command, or grab the package from GitHub.`
                    : applicationNotes
                      ? "Review what changed, then install when you’re ready."
                      : "A new version is ready to install."}
            </ui.DialogDescription>
          </ui.DialogHeader>

          {downloading || pluginInstalling ? (
            <div className="shrink-0 border-y border-border bg-muted/20 px-6 py-3" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-foreground">
                  {pluginInstalling
                    ? pluginProgressLabel
                    : progress !== null
                      ? `${progress.toFixed(0)}% — ${formatBytes(status.downloaded)}`
                      : formatBytes(status.downloaded)}
                </span>
                {pluginInstalling && pluginProgressValue !== undefined ? (
                  <span className="font-mono text-muted-foreground">
                    {pluginProgressValue.toFixed(0)}%
                  </span>
                ) : null}
              </div>
              <ui.Progress
                value={pluginInstalling ? pluginProgressValue : progress ?? undefined}
                className={progress === null && !pluginInstalling ? "animate-pulse" : undefined}
              />
            </div>
          ) : null}

          {pluginRelease ? (
            <div
              className="min-h-0 flex-1 overflow-y-auto px-6 py-3"
              data-testid="plugin-release-scroll-region"
            >
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              What’s new
            </p>
            <div
              className="divide-y divide-border overflow-hidden rounded-lg border border-border"
              data-testid="plugin-release-items"
            >
              {pluginRelease.plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="bg-muted/20 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{plugin.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {plugin.currentVersion ?? "new"} → {plugin.version}
                    </span>
                  </div>
                  {plugin.notes ? (
                    <p className="mt-1 line-clamp-3 break-words text-xs text-muted-foreground">
                      {plugin.notes}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {pluginRelease.skipped?.length ? (
              <div className="mt-4" data-testid="plugin-release-skipped">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Left untouched
                </p>
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {pluginRelease.skipped.map((plugin) => (
                    <div key={plugin.id} className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium">{plugin.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">Customized</span>
                      </div>
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {plugin.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            </div>
          ) : null}

          {applicationNotes || manual ? (
            <div
              className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
              data-testid="application-release-content"
            >
              {applicationNotes ? (
                <section aria-labelledby="application-release-notes-heading">
                  <p
                    id="application-release-notes-heading"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    What’s new
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">
                    {applicationNotes}
                  </p>
                </section>
              ) : null}
              {manual ? (
                <div className={applicationNotes ? "mt-4" : undefined}>
                  <ManualInstallPanel
                    distro={distro}
                    onSelectDistro={setDistro}
                    activeCommand={activeCommand}
                    copied={copied}
                    onCopy={() => void copyCommand()}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <ui.DialogFooter className="shrink-0 px-6 py-4" data-testid="update-dialog-footer">
            {status.kind === "available" ? (
              <>
                <ui.Button variant="ghost" size="sm" onClick={dismissUpdater}>
                  Later
                </ui.Button>
                <ui.Button size="sm" onClick={() => void install()}>
                  Install &amp; restart
                </ui.Button>
              </>
            ) : null}
            {status.kind === "plugin-available" ? (
              <>
                <ui.Button variant="ghost" size="sm" onClick={dismissUpdater}>
                  Later
                </ui.Button>
                <ui.Button size="sm" onClick={() => void install()}>
                  Update plugins
                </ui.Button>
              </>
            ) : null}
            {status.kind === "plugin-installed" ||
            status.kind === "plugin-blocked" ||
            status.kind === "plugin-rolled-back" ? (
              <ui.Button size="sm" onClick={dismissUpdater}>
                Done
              </ui.Button>
            ) : null}
            {manual ? (
              <>
                <ui.Button variant="ghost" size="sm" onClick={dismissUpdater}>
                  Later
                </ui.Button>
                <ui.Button
                  size="sm"
                  onClick={() =>
                    void dependencies.desktop.openUrl(manual.releaseUrl)
                  }
                >
                  Download package
                </ui.Button>
              </>
            ) : null}
          </ui.DialogFooter>
        </ui.DialogContent>
      </ui.Dialog>
      </Fragment>
    );
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PluginBootstrapProgress,
  PluginBootstrapStatus,
} from "../platform/pluginBootstrap";
import { bridge } from "../native/bridge";

const STAGES = [
  { id: "connecting", label: "Connect to the official feed" },
  { id: "verifying", label: "Verify the publisher signature" },
  { id: "downloading", label: "Download the current plugin set" },
  { id: "preparing", label: "Prepare plugins for this computer" },
  { id: "activating", label: "Open your workspace" },
] as const;

type ViewState = "welcome" | "installing" | "ready" | "failed";

function stageIndex(progress: PluginBootstrapProgress | null): number {
  if (!progress) return -1;
  return STAGES.findIndex((stage) => stage.id === progress.stage);
}

function readableError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error:\s*/, "");
}

export function FirstLaunchSetup(props: {
  status: Extract<PluginBootstrapStatus, { kind: "required" }>;
  onInstalled(): Promise<void> | void;
}) {
  const [view, setView] = useState<ViewState>("welcome");
  const [progress, setProgress] = useState<PluginBootstrapProgress | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);
  const { onInstalled } = props;

  const install = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setError("");
    setView("installing");
    try {
      await bridge().installPluginBootstrap();
      setView("ready");
      await new Promise((resolve) => setTimeout(resolve, 650));
      await onInstalled();
    } catch (installError) {
      started.current = false;
      setError(readableError(installError));
      setView("failed");
    }
  }, [onInstalled]);

  useEffect(() => bridge().onPluginBootstrapProgress(setProgress), []);
  useEffect(() => {
    const timer = setTimeout(() => void install(), 550);
    return () => clearTimeout(timer);
  }, [install]);

  const activeStage = stageIndex(progress);
  const prepared =
    progress?.stage === "preparing" && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : null;

  return (
    <main className="termco-setup" data-testid="first-launch-setup">
      <div className="termco-setup__grain" aria-hidden="true" />
      <header className="termco-setup__titlebar" data-drag-region>
        <div className="termco-setup__brand">
          <span className="termco-setup__mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>Termco</span>
        </div>
        <span className="termco-setup__version">
          setup / {props.status.applicationVersion}
        </span>
      </header>

      <div className="termco-setup__layout">
        <section className="termco-setup__intro" aria-labelledby="setup-title">
          <p className="termco-setup__eyebrow">Your workspace starts here</p>
          <h1 id="setup-title">
            A small app.
            <br />
            <span>A workspace that evolves.</span>
          </h1>
          <p className="termco-setup__lede">
            Termco keeps its desktop foundation lean, then installs the current
            official tools for your version. Future plugin updates arrive
            independently—without replacing the whole application.
          </p>

          <fieldset
            className="termco-setup__trust"
            aria-label="Setup guarantees"
          >
            <div>
              <strong>Signed</strong>
              <span>Publisher identity verified before installation</span>
            </div>
            <div>
              <strong>Matched</strong>
              <span>Only plugins compatible with this Termco version</span>
            </div>
            <div>
              <strong>Recoverable</strong>
              <span>Incomplete downloads never replace the active set</span>
            </div>
          </fieldset>
        </section>

        <section className="termco-setup__console" aria-live="polite">
          <div className="termco-setup__console-head">
            <div>
              <span className="termco-setup__console-kicker">Official plugin set</span>
              <strong>
                {view === "ready"
                  ? "Workspace ready"
                  : view === "failed"
                    ? "Setup paused"
                    : "Preparing Termco"}
              </strong>
            </div>
            <span
              className={`termco-setup__pulse ${view === "failed" ? "is-failed" : ""}`}
              aria-hidden="true"
            />
          </div>

          <ol className="termco-setup__stages">
            {STAGES.map((stage, index) => {
              const complete = view === "ready" || index < activeStage;
              const active = view === "installing" && index === activeStage;
              return (
                <li
                  key={stage.id}
                  className={`${complete ? "is-complete" : ""} ${active ? "is-active" : ""}`}
                >
                  <span className="termco-setup__node" aria-hidden="true">
                    {complete ? "✓" : index + 1}
                  </span>
                  <span className="termco-setup__stage-copy">
                    <strong>{stage.label}</strong>
                    {active && progress?.pluginName ? (
                      <small>{progress.pluginName}</small>
                    ) : null}
                  </span>
                  {active && prepared !== null ? (
                    <span className="termco-setup__percent">{prepared}%</span>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {view === "failed" ? (
            <div className="termco-setup__error" role="alert">
              <strong>Termco could not finish setup.</strong>
              <p>{error}</p>
              <button type="button" onClick={() => void install()}>
                Try again
              </button>
            </div>
          ) : (
            <div className="termco-setup__source">
              <span>source</span>
              <code>github.com/{props.status.repository}</code>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

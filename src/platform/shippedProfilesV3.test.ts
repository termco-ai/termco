import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProfilePluginRowV3, TermcoProfileV3 } from "./contracts";
import { parseProfileV3 } from "./profile";

const root = process.cwd();

const foundationIds = [
  "agent-hooks-native",
  "agent-activity-native",
  "desktop-native",
  "application-identity-native",
  "secrets-native",
  "storage-json",
  "preferences-json",
  "storage-bridge",
  "theme-native",
  "theme-file-editing",
  "ssh-auto-connect",
  "mcp-rig-sync",
  "ai-registry-native",
  "ai-session-state-native",
  "mcp-tool-bridge",
  "ai-tools-mcp-native",
  "ai-tools-lsp-native",
  "ai-tools-todo-native",
  "ai-tools-ask-user-native",
  "ai-tools-skill-native",
  "ai-tools-transcript-native",
  "ai-tools-system-native",
  "ai-tools-git-native",
  "ai-tools-containers-native",
  "ai-tools-terminal-native",
  "ai-tools-files-native",
  "ai-tools-browser-native",
  "ai-tools-ui-native",
  "ai-tools-plugin-dev-native",
  "ai-tools-managed-agents-native",
  "ai-inference-native",
  "ai-speech-native",
  "ai-tools-subagents-native",
  "workflows-native",
  "ai-tools-workflows-native",
  "models-native",
  "shortcuts-native",
  "workspace-native",
  "workspace-environment-native",
  "workspace-rig-workflows-native",
  "workspace-rigs-native",
  "workspace-tabs-native",
  "workspace-presentation-native",
  "workspace-tab-actions-native",
  "sidebar-navigation-native",
  "surface-search-native",
  "ui-change-reveal-native",
  "workspace-shell-native",
  "events-native",
  "pty-native",
  "ssh-native",
  "files-native",
  "file-icons-native",
  "git-native",
  "history-native",
  "shell-native",
  "containers-native",
  "http-native",
  "updater-native",
  "session-native",
  "session-query-native",
  "ai-context-artifacts-native",
  "mcp-native",
  "mcp-server-native",
  "search-sidebar",
  "explorer-sidebar",
  "source-control-sidebar",
  "ports-sidebar",
  "header-native",
  "command-palette-state-native",
  "command-palette-native",
  "settings-native",
  "statusbar-native",
  "rigs-commands",
  "markdown-surface",
  "preview-surface-native",
  "git-surface",
  "ai-diff-surface",
  "ui-shell-native",
  "plugin-manager-native",
  "about-native",
  "appearance-settings",
  "models-settings",
  "shortcuts-settings",
  "editor-settings",
  "general-settings",
  "languages-settings",
  "terminal-settings",
  "terminal-surface-native",
  "terminal-workspace-footer-native",
  "editor-surface-native",
  "browser-native",
  "lsp-native",
  "coding-agent-native",
  "ai-library-native",
  "ai-live-native",
  "ai-chat-native",
  "selection-ask-ai-native",
  "managed-agent-runtime-native",
  "agents-manager-native",
  "skills-panel-native",
  "trajectory-native",
] as const;

const corePluginIds = new Set([
  "boot-diagnostics-native",
  "plugin-manager-native",
  "safe-recovery-native",
  "settings-native",
  "ui-shell-native",
  "updater-native",
  "workspace-shell-native",
]);

const row = (id: string): ProfilePluginRowV3 => ({
  id,
  module: corePluginIds.has(id)
    ? `bundled:core-plugins/${id}`
    : `bundled:plugin-repository/plugins/${id}`,
});

const defaultIds = foundationIds.flatMap((id) =>
  id === "plugin-manager-native"
    ? [
        id,
        "onboarding-native",
        "onboarding-ui-native",
        "onboarding-content-native",
      ]
    : [id],
);

function loadProfile(relativePath: string): TermcoProfileV3 {
  const input = JSON.parse(
    readFileSync(join(root, relativePath), "utf8"),
  ) as unknown;
  const parsed = parseProfileV3(input);
  expect(parsed.ok, parsed.ok ? undefined : parsed.error).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.profile;
}

describe("shipped profile v3 compositions", () => {
  it("ships the former foundation plus the renderer storage bridge", () => {
    const profile = loadProfile("profiles/default/profile.json");

    expect(profile).toEqual({
      schemaVersion: 3,
      id: "termco.default",
      bundles: [],
      plugins: defaultIds.map(row),
      patches: [],
    });
  });

  it("preserves the company profile order and disablement", () => {
    const profile = loadProfile("profiles/company-example/profile.json");
    const baseRows = foundationIds
      .map(row)
      .map((plugin) =>
        ["http-native", "statusbar-native", "trajectory-native"].includes(
          plugin.id,
        )
          ? { ...plugin, enabled: false }
          : plugin,
      );

    expect(profile).toEqual({
      schemaVersion: 3,
      id: "company.example",
      bundles: [],
      plugins: [
        ...baseRows,
        row("company-example-http"),
        row("company-example-statusbar"),
        row("company-example-command"),
      ],
      patches: [],
    });
  });

  it("preserves the recovery profile order", () => {
    const profile = loadProfile("profiles/safe-recovery/profile.json");

    expect(profile).toEqual({
      schemaVersion: 3,
      id: "termco.safe-recovery",
      bundles: [],
      plugins: [
        ...foundationIds.map(row),
        row("boot-diagnostics-native"),
        row("safe-recovery-native"),
      ],
      patches: [],
    });
  });

  it("removes the obsolete foundation profile artifact", () => {
    expect(existsSync(join(root, "profiles/v2-foundation/profile.json"))).toBe(
      false,
    );
  });
});

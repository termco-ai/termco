import {
  domOnboardingTarget,
  type OnboardingContribution,
} from "@termco/onboarding-base";
import type { UiSettingsViewCapability } from "@termco/ui-settings-base";

const byTestId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function settingsTarget(
  settings: UiSettingsViewCapability,
  section: "plugins" | "profiles",
  id: string,
  label: string,
  element: () => HTMLElement | null,
) {
  return domOnboardingTarget({
    id,
    label,
    reveal: () => settings.show(section),
    element,
  });
}

export function createPluginManagerOnboardingContribution(
  settings: UiSettingsViewCapability,
): OnboardingContribution {
  return {
    id: "plugin-manager-guidance",
    targets: [
      settingsTarget(settings, "plugins", "plugin-manager.catalog", "Plugin catalog", () => byTestId("plugins-section")),
      settingsTarget(settings, "plugins", "plugin-manager.filters", "Plugin status filters", () => byTestId("plugin-status-active")),
      settingsTarget(settings, "plugins", "plugin-manager.plugin", "Installed plugin", () => document.querySelector<HTMLElement>('[data-testid^="profile-plugin-row-"]')),
      settingsTarget(settings, "plugins", "plugin-manager.fork", "Fork plugin action", () => document.querySelector<HTMLElement>('[data-testid^="profile-plugin-copy-"]')),
      settingsTarget(settings, "profiles", "profile-manager.overview", "Profiles settings", () => byTestId("profiles-section")),
      settingsTarget(settings, "profiles", "profile-manager.name", "Profile name", () => byTestId("profile-export-name")),
      settingsTarget(settings, "profiles", "profile-manager.export", "Export Profile Package", () => byTestId("profile-export")),
      settingsTarget(settings, "profiles", "profile-manager.import", "Import Profile Package", () => byTestId("profile-import")),
    ],
    journeys: [
      {
        id: "plugin-manager-native.understand-and-adapt",
        title: "Understand and adapt Termco plugins",
        description: "See which plugin owns each capability, inspect active state, and create a safe editable variant.",
        order: 40,
        estimatedMinutes: 5,
        presentation: "contextual",
        steps: [
          {
            id: "catalog",
            version: 1,
            kind: "tour",
            title: "The application is the plugin catalog",
            scope: { kind: "profile" },
            targetId: "plugin-manager.catalog",
            body: {
              markdown: "This is not an add-on list beside a fixed application. Termco's header, workspace, terminal, Chat, containers, Settings, tools, and providers are profile-selected plugins with explicit owners and dependencies.",
            },
          },
          {
            id: "status",
            version: 1,
            kind: "interaction",
            title: "Inspect the live composition",
            scope: { kind: "profile" },
            targetId: "plugin-manager.filters",
            expectation: { kind: "click" },
            body: {
              markdown: "Filter by active, reduced, blocked, failed, or inactive status. Missing source is repaired into an explicit stale state instead of leaving an invisible profile entry that breaks plugin actions.",
            },
          },
          {
            id: "owner",
            version: 1,
            kind: "tour",
            title: "Every feature exposes its owner",
            scope: { kind: "profile" },
            targetId: "plugin-manager.plugin",
            body: {
              markdown: "A plugin row explains what it owns, whether it is live, and which dependencies would be affected by a change. Open its folder to inspect the complete source rather than editing hidden application code.",
            },
          },
          {
            id: "fork",
            version: 1,
            kind: "tour",
            title: "Change an existing feature safely",
            scope: { kind: "profile" },
            targetId: "plugin-manager.fork",
            body: {
              markdown: "Fork creates a complete editable plugin variant. Use the Plugin Creator agent when you want Termco to clarify the outcome, plan against public contracts, implement the draft, apply it transactionally, and verify the visible result.",
            },
          },
        ],
      },
      {
        id: "plugin-manager-native.create-profile",
        title: "Create and share a Termco profile",
        description: "Package company plugins and portable defaults without exporting credentials or developer history.",
        order: 50,
        estimatedMinutes: 4,
        presentation: "contextual",
        steps: [
          {
            id: "overview",
            version: 1,
            kind: "tour",
            title: "A profile is a portable Termco composition",
            scope: { kind: "profile" },
            targetId: "profile-manager.overview",
            body: {
              markdown: "Profiles capture the selected plugin graph, customized plugin source, and allow-listed company defaults. They deliberately exclude model keys, SSH secrets, workspaces, history, running processes, and personal onboarding progress.",
            },
          },
          {
            id: "name",
            version: 1,
            kind: "interaction",
            title: "Name the setup your team will recognize",
            scope: { kind: "profile" },
            targetId: "profile-manager.name",
            expectation: { kind: "input", completion: "changed" },
            body: {
              markdown: "Enter a durable name such as **Platform Engineering**. Add a revision when the company changes plugins or defaults so imports remain understandable and auditable.",
            },
          },
          {
            id: "export",
            version: 1,
            kind: "tour",
            title: "Export the reviewed package",
            scope: { kind: "profile" },
            targetId: "profile-manager.export",
            body: {
              markdown: "Export writes a validated Profile Package containing the portable composition. The save dialog is the only external step; no account or Termco cloud is required.",
            },
          },
          {
            id: "import",
            version: 1,
            kind: "tour",
            title: "A teammate validates before activation",
            scope: { kind: "profile" },
            targetId: "profile-manager.import",
            body: {
              markdown: "Import validates identifiers, versions, source integrity, and package structure before installation. The recipient can inspect the new profile and then activate it without overwriting their secrets or personal data.",
            },
          },
        ],
      },
    ],
  };
}

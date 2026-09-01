/** Plugins that must stay active so the user can recover through the UI. */
export const essentialPluginReasons: ReadonlyMap<string, string> = new Map([
  [
    "ui-shell-native",
    "It renders the application window; disabling it would leave no UI to recover from.",
  ],
  [
    "workspace-shell-native",
    "It hosts the workspace and settings surfaces; disabling it would blank the window.",
  ],
  [
    "settings-native",
    "It hosts Plugin Manager; disabling it would remove the UI needed to re-enable plugins.",
  ],
  [
    "plugin-manager-native",
    "It provides this manager; disabling it would remove the UI needed to re-enable itself.",
  ],
]);

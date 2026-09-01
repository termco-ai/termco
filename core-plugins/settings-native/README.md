# Settings Application

This folder owns the application-wide settings state and complete settings
workspace: categorized navigation, search across every contributed setting,
section descriptions, failure isolation, theme toggle, responsive layout, and
close/deep-link behavior.

Individual settings sections remain separate `ui.settings.sections`
contributions. Copy this folder to replace the settings application without
copying the model, terminal, language, appearance, or plugin-manager sections.
The rail logo is read from `application.branding`; it is not an asset secretly
owned by this shell.

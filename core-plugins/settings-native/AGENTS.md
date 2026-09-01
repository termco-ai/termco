# Plugin boundary

- Import lifecycle types from `@termco/kernel`, service contracts and constants
  from their owning `@termco/*-base` packages, and UI primitives from
  `@termco/ui`.
- This folder owns settings navigation state and all settings-shell UI.
- Sections must be consumed through `ui.settings.sections`.
- Never import a settings section or private host store.

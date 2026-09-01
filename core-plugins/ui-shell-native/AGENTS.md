# Plugin boundary

- Import lifecycle types from `@termco/kernel`, service contracts and constants
  from their owning `@termco/*-base` packages, and UI primitives from
  `@termco/ui`.
- Do not import `src/`, `electron/`, `@/`, or another plugin directory.
- Keep application-root composition and its behavior tests inside this folder.
- Obtain product behavior only through declared capabilities.

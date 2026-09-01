# Plugin boundary

- Own all Plugin Manager product UI and catalog presentation here.
- Provide `profile.catalog`, `profile.transactions`, and `plugin.catalog` from
  the injected kernel process transport's host control.
- Import only owning `@termco/*-base` packages, `@termco/kernel`, and
  `@termco/ui` from Termco.
- Do not import application source, legacy plugin-host state, or the preload bridge.

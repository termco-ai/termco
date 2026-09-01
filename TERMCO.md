# Termco architecture

Termco loads this file as repository context for development tools.

## Product

Termco is an Electron desktop workspace with a React 19 renderer, `node-pty`,
xterm.js, and bring-your-own-key AI through the Vercel AI SDK.

- Bundle id: `app.termco`
- Package manager: pnpm
- Platforms: macOS, Linux, Windows

## Plugin architecture

- The kernel owns package loading, contexts, dependency injection, lifecycle,
  generic cross-process transport, and boot/shutdown mechanics.
- Plugins and base packages define named services. Product contracts,
  providers, consumers, contribution registries, UI surfaces, commands,
  workflows, and the default application composition live in plugins.
- Consumers depend on public service packages and names, never provider source.
- One selected provider owns shared state such as SSH connection pools or PTY
  sessions. Multi-owner contributions are managed by an owning registry.
- Copying a complete plugin folder, editing it, and selecting it as a live
  replacement is a primary product operation.
- Do not add compatibility adapters, parallel runtimes, or host-owned product
  services.

See [`docs/plugin-api.md`](docs/plugin-api.md) for the plugin author contract.

## Fidelity boundary

Architecture work must not change capabilities, functionality, layouts, icons,
copy, interactions, state semantics, shortcuts, or failure behavior. Unit,
integration, Electron, visual, and E2E tests define the observable contract.

## Source and quality rules

- Use relative imports within a plugin and public service packages between them.
- Never import another plugin's implementation source.
- Keep product-specific UI, styles, assets, behavior, and tests with their
  owning plugin.
- Ensure deactivation disposes registrations, listeners, timers, processes,
  and shared resources owned by the plugin generation.
- Preserve one shared React realm and avoid duplicate providers or state.
- Cover failure, concurrency, replacement, rollback, cleanup, and persistence.
- Use shared UI primitives and tokens without moving product composition into
  the host.
- Use pnpm for package and script commands.

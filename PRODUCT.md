# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Termco is primarily for individual software developers working locally. They use it to move between terminal commands, code editing, source control, local web previews, and AI-assisted development without leaving the workspace.

## Product Purpose

Termco is an open-source, terminal-first AI development workspace. It combines a high-performance terminal with an editor, file explorer, source control, web preview, and agentic AI tools so developers can complete local development workflows in one application.

Success means developers can work quickly with low resource overhead while retaining control over their tools, models, credentials, and project data.

## Positioning

Termco is differentiated by a lightweight, terminal-first workflow with private, provider-independent AI. Developers can bring their own provider keys or run local models instead of depending on a required account, hosted model, or single AI vendor.

## Operating Context

Termco is a desktop application used against local development workspaces on macOS, Linux, and Windows. Core workflows include:

- running interactive shells and long-lived development processes;
- editing and navigating project files;
- reviewing and changing source control state;
- previewing local web applications;
- using AI agents to plan, inspect, edit, and run project work;
- switching among local, WSL, and container-backed development environments where supported.

## Capabilities and Constraints

- Electron desktop application with a React and TypeScript interface and a native PTY backend.
- Supports macOS, Linux, and Windows.
- Supports provider-hosted AI through user-supplied credentials and local or offline models.
- AI credentials are stored in the operating system keychain and must not be written to application storage.
- No Termco account and no telemetry.
- Performance and low resource usage are product requirements. Unused features should consume no resources.
- Filesystem, process, network, Git, secrets, and AI tool access must remain validated at native process boundaries.
- The terminal is the primary workspace rather than an accessory to an editor.

## Brand Commitments

- Product name: Termco.
- Open source under the Apache-2.0 license.
- Terminal-first and AI-native.
- Lightweight, private, and developer-controlled.
- No required account and no telemetry.
- Supports both bring-your-own-key providers and fully local models.

## Evidence on Hand

- Product overview, feature inventory, installation guidance, and public commitments in `README.md`.
- Architecture, quality requirements, security boundaries, and engineering constraints in `TERMCO.md`.
- Existing product implementation under `src/` and `electron/`.
- Existing Termco logo assets at `public/logo.png` and `termco-icon.png`.
- Automated interaction coverage under `e2e/`.
- No testimonials, customer logos, benchmarks, or commercial claims are established in the repository and future work must not fabricate them.

## Product Principles

1. Keep the terminal at the center of the development workflow.
2. Give developers control over providers, models, credentials, and project data.
3. Deliver integrated capability without sacrificing speed or resource efficiency.
4. Preserve cross-platform behavior and native operating-system expectations.
5. Maintain open-source transparency and avoid mandatory accounts or telemetry.

## Accessibility & Inclusion

No product-specific accessibility standard or audience requirement has been confirmed yet. Cross-platform keyboard operation and readable, adaptable themes are established capabilities, but a formal conformance target remains an open decision.

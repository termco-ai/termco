# Termco Plugin API

Termco plugins are ordinary packages selected by an ordered profile. Runtime
services are open: a package owns its public contract and service-name constant,
and executable plugins provide or inject that service through
`@termco/kernel`. Adding a company service requires packages and profile rows,
not a central service registration.

## Source package

Keep each editable unit complete:

```text
company-clock-provider/
  termco-plugin.json
  package.json
  README.md
  AGENTS.md
  src/
    main.ts
    main.test.ts
  assets/                 # optional plugin-owned assets
```

Source, behavior tests, styles, and assets stay inside the package. A runtime
package may expose `renderer`, `main`, or `utility` entrypoints. A
contract-only package omits `entrypoints` and is never activated as a runtime
Fiber.

Public service contracts come from their owning `*-base` package. Import
`PluginModule`, activation-scope types, and `Dispose` from
`@termco/kernel`. Renderer plugins may import the shared React realm and UI
primitives from `@termco/ui`. Import another plugin's contract package, never
its source files.

### Floating UI above native browser surfaces

Renderer plugins that use the shared `@termco/ui` dialog, alert-dialog, sheet,
popover, menu, select, hover-card, or toast primitives automatically render
above a live native browser surface. No browser snapshot or replacement image
is involved.

For a custom portal, coach mark, drag ghost, or other floating surface, mark
the mounted root with `data-termco-overlay="true"` or use the exported
`useOverlayGuard` hook. Prefer a ref for bounded floating UI so Termco only
raises the renderer when that surface intersects the browser:

```tsx
import { useOverlayGuard } from "@termco/ui";
import { useRef } from "react";

export function CompanyPopup() {
  const popupRef = useRef<HTMLDivElement>(null);
  useOverlayGuard(popupRef);
  return <div ref={popupRef}>Company popup</div>;
}
```

Call `useOverlayGuard()` without a ref only for a full-window overlay. Custom
floating UI that uses neither the shared primitives nor this opt-in contract
cannot be detected by the host and may remain behind a native browser view.

## Create, fork, and replace are different operations

Every authoring mutation starts with `plugin_plan`. The plan is a pure preflight
that freezes the mutation intent, new identity, optional source, exact generated
target contract, semantic verification proofs, and reveal policy. It changes no
file and no profile row. The returned `planId` is the only argument accepted by
`plugin_create`, `plugin_fork`, and `plugin_copy_and_replace`; a plan for one
intent cannot be used for another.

- **Create** prepares a new independent plugin draft from the contribution
  contract matching the requested surface. It compiles outside the active
  profile, never declares `replaces`, and never changes another row. Use
  `ui.overlays` for an application-wide FAB, dialog, or HUD and
  `ui.sidebar.views` for a left-rail icon and view.
- **Fork** copies an existing package into an independent derivative with new
  package and plugin ids but no `replaces` claim. A fork may need its service
  ids or contribution keys changed before it can run alongside its source, so
  it also remains outside the active profile until final apply.
- **Replace** prepares an intentional replacement draft from an active source
  and declares `replaces`, but it does not disable the original yet. The final
  apply performs the one transactional substitution. Do not use replacement to
  bootstrap unrelated UI.

After editing and testing the managed draft, `plugin_apply` compiles it again
and creates or replaces the profile row exactly once. A failed compile or
activation keeps the prior graph active and leaves the same draft editable.

`plugin_verify` accepts only the successful apply's `completionId`. It reuses
the exact owner, generation, contribution keys, accessible targets, safe
actions, and postconditions frozen before the mutation. A successful report is
canonical session output and renders a durable completion card with **Show
again**, **Open plugin folder**, **Disable**, and **Undo**. Verification criteria
cannot be invented or weakened after activation.

The Plugin Creator must select exactly the operation requested by the user. It
must not silently fall back from create or fork to replace.

## Plugin-owned onboarding

Every Plugin Creator brief resolves onboarding before planning. A user-facing
Create, Fork, or Replace either includes a short real-work journey or records
that the user chose to omit it. Provider-only and otherwise non-interactive
plugins record onboarding as not applicable. That decision, including journey
and step identities, is frozen into `plugin_plan` and checked by
`plugin_verify` after activation.

Onboarding is an optional enhancement, never a hard runtime dependency. Put
`ONBOARDING_REGISTRY_SERVICE` in `optionalInject`, declare
`@termco/onboarding-base` in both manifests, and register with
`contributeOnboarding`. The helper scopes the registration to the plugin id and
generation and removes it with the plugin lifecycle:

```ts
import type { PluginModule } from "@termco/kernel";
import {
  ONBOARDING_REGISTRY_SERVICE,
  contributeOnboarding,
  domOnboardingTarget,
} from "@termco/onboarding-base";

const plugin: PluginModule = {
  optionalInject: [ONBOARDING_REGISTRY_SERVICE],
  async activate(context) {
    contributeOnboarding(context, {
      id: "company-clock-guidance",
      journeys: [{
        id: "company-clock-getting-started",
        title: "Read the company clock",
        description: "Find and use the company time display.",
        presentation: "contextual",
        steps: [{
          id: "open-clock",
          version: 1,
          title: "Open the clock",
          kind: "interaction",
          scope: { kind: "user" },
          targetId: "company-clock-button",
          expectation: { kind: "click" },
          body: { markdown: "Choose **Company clock**." },
        }],
      }],
      targets: [domOnboardingTarget({
        id: "company-clock-button",
        label: "Company clock",
        element: () => document.querySelector('[data-onboarding="company-clock"]'),
      })],
    });
  },
};
```

Use `contextual` only when the plugin has a safe feature-owned moment to call
`OnboardingRuntime.suggest`; otherwise use `available`. Generated plugins never
use `automatic`. New plugins and independent forks namespace journey and target
ids to their own plugin id. Replacements preserve equivalent journey and step
ids so progress survives, and increment a step's version when its meaning
changes. Every tour, interaction, or navigation target must be contributed by
the same live plugin generation.

## Package-owned contracts

A base package owns the service name and its TypeScript contract. For an
external clock service, `package.json` can be:

```json
{
  "name": "@company/clock-base",
  "version": "1.0.0",
  "type": "module",
  "exports": "./src/index.ts",
  "dependencies": {
    "@termco/kernel": "1.0.0"
  }
}
```

Its `src/index.ts` exports a unique literal service constant and augments the
kernel's open `Services` interface:

```ts
export const COMPANY_CLOCK_SERVICE = "company.clock" as const;

export interface CompanyClock {
  now(): number;
}

declare module "@termco/kernel" {
  interface Services {
    [COMPANY_CLOCK_SERVICE]: CompanyClock;
  }
}
```

The base package also carries a strict contract-only
`termco-plugin.json`:

```json
{
  "schemaVersion": 3,
  "id": "company.clock-base",
  "name": "Company Clock Base",
  "description": "Public company clock service contract.",
  "category": "Contracts",
  "version": "1.0.0",
  "dependencies": {
    "@termco/kernel": "1.0.0"
  }
}
```

The augmentation supplies compile-time types; it is not a runtime allowlist.
The service constant, provider, consumer, and profile row are sufficient. No root registry edit is required.

## Strict v3 manifest

Every plugin root contains `termco-plugin.json`. This provider manifest is a
complete v3 example:

```json
{
  "schemaVersion": 3,
  "id": "company.clock-provider",
  "name": "Company Clock Provider",
  "description": "Provides the company wall clock.",
  "category": "Company services",
  "version": "1.0.0",
  "entrypoints": {
    "main": "src/main.ts"
  },
  "dependencies": {
    "@company/clock-base": "1.0.0",
    "@termco/kernel": "1.0.0"
  },
  "activation": "eager"
}
```

The schema accepts only source and package metadata:

- `id` is a namespaced lowercase id; `version` is exact semver.
- `entrypoints` paths stay inside the package. Contract-only packages omit
  the field.
- `dependencies` lists every imported public contract and third-party
  package. Keep the same exact dependencies in `package.json`.
- `assetBuilds` may compile a readable source entry to a generated
  `assets/*.mjs` cache path.
- `activation` is `eager` or `lazy`.
- `replaces` identifies a package this plugin completely substitutes.

Service relationships live in executable modules through `inject`,
`context.get`, and `context.provide`; they are not manifest policy fields.

## PluginModule and the activation scope

A provider publishes an arbitrary service name through its base-package
constant. Resources are installed through `context.effect` so the Fiber owns
their cleanup:

```ts
import {
  COMPANY_CLOCK_SERVICE,
  type CompanyClock,
} from "@company/clock-base";
import type { PluginModule } from "@termco/kernel";

let ticks = 0;

const plugin: PluginModule = {
  async activate(context) {
    await context.effect(() => {
      const timer = setInterval(() => {
        ticks += 1;
      }, 1_000);
      return () => clearInterval(timer);
    });

    const clock: CompanyClock = { now: () => Date.now() };
    context.provide(COMPANY_CLOCK_SERVICE, clock);
  },
};

export default plugin;
```

A consumer declares every direct service dependency in `inject`, then obtains
the typed value with the same constant:

```ts
import {
  COMPANY_CLOCK_SERVICE,
  type CompanyClock,
} from "@company/clock-base";
import type { PluginModule } from "@termco/kernel";

const plugin: PluginModule = {
  inject: [COMPANY_CLOCK_SERVICE],
  activate(context) {
    const clock = context.get<CompanyClock>(COMPANY_CLOCK_SERVICE);
    return startCompanySchedule(() => clock.now());
  },
};

export default plugin;
```

A Fiber remains pending until every injected service is available. Missing
services and failed activation are reported with the consumer plugin id.
`context.provide`, `context.effect`, and a disposer returned by
`activate` all belong to the activation scope and are cleaned up together.

## Providers and registries

An ordinary service has one selected ordinary provider in a runtime context.
The provider owns its state, connections, persistence, collision policy, and
cleanup. A second live provision for the same ordinary service fails with both
provider identities instead of silently replacing state.

Multi-entry behavior is itself an ordinary service. Its selected registry provider
owns a typed `register` method, stable ordering, duplicate-id
behavior, snapshots, subscriptions, and idempotent removal. Contributors inject
that registry and install the disposer returned by `register` with
`context.effect`. This keeps contribution policy in the service family rather
than in the generic kernel.

Choose providers by selecting profile rows. Consumers depend only on the base
contract, so replacing a provider does not change their imports.

## Process boundaries

The manifest entrypoint determines whether a Fiber runs in the renderer, main,
or a utility process. A service used within one process needs no additional
mechanism.

A cross-process service uses a service-family process bridge. That bridge owns
the wire schema, method projection, serialization, streaming, cancellation,
errors, and cleanup for its contract. The generic kernel transport supplies
routing and caller identity; it does not contain product service names or
methods. The bridge is an ordinary selectable plugin, so a company service can
ship its own transport without editing host dispatch tables.

This is the process bridge contract concept, not a promise of a concrete helper
API. Authors should use the bridge package supplied by the service family and
keep values crossing the boundary serializable.

## Ordered profiles

A strict v3 profile is an ordered composition of stable rows:

```json
{
  "schemaVersion": 3,
  "id": "company.clock-demo",
  "bundles": [],
  "plugins": [
    {
      "id": "company.clock-provider",
      "module": "@company/clock-provider"
    },
    {
      "id": "company.clock-consumer",
      "module": "@company/clock-consumer"
    },
    {
      "id": "company.legacy-clock-widget",
      "module": "@company/legacy-clock-widget"
    }
  ],
  "patches": [
    {
      "op": "insert",
      "plugin": {
        "id": "company.clock-audit",
        "module": "@company/clock-audit"
      },
      "after": "company.clock-provider"
    },
    {
      "op": "disable",
      "target": "company.clock-consumer"
    },
    {
      "op": "remove",
      "target": "company.legacy-clock-widget"
    },
    {
      "op": "replace",
      "target": "company.clock-provider",
      "plugin": {
        "id": "company.clock-provider",
        "module": "@company/clock-provider-next"
      }
    }
  ]
}
```

`bundles` names reusable profile layers composed recursively before the active
profile. `plugins` appends rows in source order. Later `patches` may insert
with at most one `before` or `after` anchor, disable, remove, or replace an
existing stable row. A replacement preserves the target row id. Duplicate rows,
missing targets, missing anchors, and bundle cycles fail with the responsible
layer and row.

A row's `module` may be a bundled source, a file or local path, or an
installed package name such as `@company/clock-provider`. Row order defines
composition and inspection order; service injection determines activation
readiness. Set `enabled` to `false` when a row must remain visible but not
run.

## Compilation and validation

The generic compiler reads each package's manifest and dependencies. It
ownership-checks every readable source file, compiles declared entrypoints and
assets, and supports arbitrary package-owned services without a central
service list.

For each package:

1. Keep behavior tests beside the source and run them directly.
2. Run `pnpm check-types:plugins`.
3. Run `pnpm build:plugins` to exercise the same ownership and dependency
   checks used for shipped packages.
4. Parse and compose the profile that selects the package.
5. Verify missing-service diagnostics by removing its provider row.
6. Verify cleanup and replacement with live resources present.

The compiler rejects private application imports, imports outside the package,
undeclared packages, escaping entrypoints or symbolic links, and runtime
packages without behavior tests. Generated output is disposable; edit the
source package.

## Lifecycle and replacement

Register every listener, timer, process, connection, contribution, and
provision in the activation scope. Cleanup must be idempotent and release the
resource when the Fiber deactivates. Deactivation follows the runtime's
dependency-safe order.

Providers with destructive live resources implement `replacementImpact`:

```ts
const plugin: PluginModule = {
  replacementImpact() {
    return [{
      capability: COMPANY_CLOCK_SERVICE,
      resourceLabel: "scheduled company clock jobs",
      resources: jobs.map((job) => ({ id: job.id, label: job.label })),
    }];
  },
};
```

Replacement stops the changed provider and the active consumers that injected
its value. Unrelated Fibers and provider state stay active. Candidate failure
reports the failed phase and rolls the runtime back; cleanup failures remain
visible rather than being swallowed.

For a package fork, change its package and plugin ids and change any exclusive
service ids or contribution keys that must coexist with the source. Leave
`replaces` unset. If the derivative is intended to completely substitute the
source instead, it is a replacement: set `replaces` and use a profile replace
operation that preserves the stable row.

## Porting an old plugin

Old manifests and profiles fail immediately with actionable diagnostics:

```text
schemaVersion: plugin targets the removed v2 architecture and must be ported to schema v3
schemaVersion: profile targets the removed v2 architecture and must be ported to schema v3
```

Port the package by moving public service types and constants into an owning
base package, importing `PluginModule` from `@termco/kernel`, declaring
direct dependencies in `inject`, and publishing services in code. Convert the
manifest to source/package metadata only. Convert profiles to ordered
`bundles`, `plugins`, and `patches`.

Removed manifest fields fail by name:

```text
provides: was removed by manifest schema v3
consumes: was removed by manifest schema v3
permissions: was removed by manifest schema v3
```

Treat these errors as a porting checklist. Rewrite the package against the v3
contract; the runtime does not load the old shape.

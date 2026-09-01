import type {
  PluginCreateRequest,
  PluginCreationTarget,
} from "../../../plugin-repository/plugins/profile-base/src/profileApi";
import { UI_CONTRIBUTION_AUTHORING_DESCRIPTORS } from "../../../plugin-repository/plugins/ui-shell-base/src/generated/authoringCatalog";
import type { TermcoPluginManifestV3 } from "../../../src/platform/contracts";

export interface PluginScaffold {
  manifest: TermcoPluginManifestV3;
  files: ReadonlyMap<string, string>;
}

type Descriptor = (typeof UI_CONTRIBUTION_AUTHORING_DESCRIPTORS)[number];

const providerTargets = new Set<PluginCreationTarget>([
  "renderer-provider",
  "main-provider",
  "server",
]);

const rendererProviderSource = `import type { PluginModule } from "@termco/kernel";

const plugin: PluginModule = {
  activate() {
    // Define and provide the requested renderer service here.
  },
};

export default plugin;
`;

const mainProviderSource = `import type { PluginModule } from "@termco/kernel";

const plugin: PluginModule = {
  activate() {
    // Define and provide the requested main-process service here.
  },
};

export default plugin;
`;

function descriptorFor(target: PluginCreationTarget): Descriptor | null {
  return UI_CONTRIBUTION_AUTHORING_DESCRIPTORS.find(
    (descriptor) => descriptor.service === target,
  ) ?? null;
}

function componentSource(
  request: PluginCreateRequest,
  descriptor: Descriptor,
): { imports: string; declaration: string; value: string } {
  if (descriptor.service === "ui.commands") {
    return { imports: "", declaration: "", value: "" };
  }
  if (descriptor.service === "ui.providers") {
    return {
      imports: 'import type { ReactNode } from "react";\n',
      declaration: `function Contribution({ children }: { children: ReactNode }) {\n  return children;\n}\n`,
      value: "Contribution",
    };
  }
  if (descriptor.service === "ui.background.tasks") {
    return {
      imports: "",
      declaration: "function Contribution() {\n  return null;\n}\n",
      value: "Contribution",
    };
  }
  if (descriptor.service === "ui.overlays") {
    return {
      imports: 'import { createElement } from "react";\n',
      declaration: `function Contribution() {
  return createElement(
    "button",
    {
      type: "button",
      "aria-label": ${JSON.stringify(request.name)},
      "data-termco-overlay": "true",
      style: {
        position: "fixed",
        right: 24,
        bottom: 48,
        zIndex: 100,
        minWidth: 48,
        minHeight: 48,
        border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
        borderRadius: 999,
        padding: "0 16px",
        background: "var(--primary)",
        color: "var(--primary-foreground)",
        cursor: "pointer",
      },
    },
    ${JSON.stringify(request.name)},
  );
}
`,
      value: "Contribution",
    };
  }
  return {
    imports: 'import { createElement } from "react";\n',
    declaration: `function Contribution() {
  return createElement(
    "section",
    { "aria-label": ${JSON.stringify(request.name)} },
    createElement("h2", null, ${JSON.stringify(request.name)}),
    createElement("p", null, ${JSON.stringify(request.description)}),
  );
}
`,
    value: "Contribution",
  };
}

function contributionFields(
  request: PluginCreateRequest,
  descriptor: Descriptor,
  component: string,
): string[] {
  const variant = request.variant ?? descriptor.variants?.[0];
  return descriptor.requiredFields.map((field) => {
    switch (field) {
      case "id": return `id: ${JSON.stringify(request.id)}`;
      case "label": return `label: ${JSON.stringify(request.name)}`;
      case "title": return `title: ${JSON.stringify(request.name)}`;
      case "description": return `description: ${JSON.stringify(request.description)}`;
      case "category": return `category: ${JSON.stringify(request.category)}`;
      case "Component": return `Component: ${component}`;
      case "run": return "run() {}";
      case "region": return `region: ${JSON.stringify(variant)}`;
      case "side": return `side: ${JSON.stringify(variant)}`;
      case "icon": return "icon: PuzzleIcon";
      case "kinds": return `kinds: [${JSON.stringify(`${request.id}.tab`)}]`;
      case "searchEntries": return "searchEntries: []";
      default:
        throw new Error(
          `authoring descriptor ${descriptor.service} has no scaffold value for required field ${field}`,
        );
    }
  });
}

function contributionSource(
  request: PluginCreateRequest,
  descriptor: Descriptor,
): string {
  const component = componentSource(request, descriptor);
  const iconImport = descriptor.requiredFields.includes("icon")
    ? 'import { PuzzleIcon } from "@hugeicons/core-free-icons";\n'
    : "";
  const fields = contributionFields(request, descriptor, component.value)
    .map((field) => `      ${field},`)
    .join("\n");
  return `import type { PluginModule } from "@termco/kernel";
import {
  ${descriptor.serviceConstant},
  type ${descriptor.contributionType},
  type ${descriptor.registryType},
} from ${JSON.stringify(descriptor.contractPackage)};
${component.imports}${iconImport}
${component.declaration}
const plugin: PluginModule = {
  inject: [${descriptor.serviceConstant}],
  async activate(context) {
    const contribution: ${descriptor.contributionType} = {
${fields}
    };
    await context.effect(() =>
      context.get<${descriptor.registryType}>(${descriptor.serviceConstant}).register(
        contribution,
        {
          pluginId: context.pluginId,
          generation: context.generation,
          key: contribution.id,
        },
      ),
    );
  },
};

export default plugin;
`;
}

function dependencies(
  descriptor: Descriptor | null,
  request: PluginCreateRequest,
): Record<string, string> {
  const result: Record<string, string> = { "@termco/kernel": "1.0.0" };
  if (request.onboarding?.decision === "include") {
    result["@termco/onboarding-base"] = "1.0.0";
  }
  if (!descriptor) return result;
  result[descriptor.contractPackage] = "1.0.0";
  if (
    descriptor.service !== "ui.commands" &&
    descriptor.service !== "ui.background.tasks"
  ) {
    result.react = "^19.2.7";
  }
  if (descriptor.requiredFields.includes("icon")) {
    result["@hugeicons/core-free-icons"] = "^3.0.0";
  }
  return result;
}

function behaviorTestSource(
  request: PluginCreateRequest,
  modulePath: "./main" | "./renderer",
  descriptor: Descriptor | null,
): string {
  if (!descriptor) {
    return `import { describe, expect, it } from "vitest";
import plugin from ${JSON.stringify(modulePath)};

describe(${JSON.stringify(request.name)}, () => {
  it("exports one lifecycle-owned provider plugin", () => {
    expect(typeof plugin.activate).toBe("function");
  });
});
`;
  }
  return `import type { Dispose, PluginActivationContext } from "@termco/kernel";
import { describe, expect, it, vi } from "vitest";
import plugin from ${JSON.stringify(modulePath)};

describe(${JSON.stringify(request.name)}, () => {
  it("registers its owned contribution and removes it through lifecycle cleanup", async () => {
    const remove = vi.fn();
    const register = vi.fn(() => remove);
    const effects: Dispose[] = [];
    const context = {
      pluginId: ${JSON.stringify(request.id)},
      generation: "test-generation",
      get(service: string) {
        expect(service).toBe(${JSON.stringify(descriptor.service)});
        return { register };
      },
      async effect(install: () => Dispose | Promise<Dispose>) {
        const dispose = await install();
        effects.push(dispose);
        return dispose;
      },
    } as unknown as PluginActivationContext;

    await plugin.activate(context);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ id: ${JSON.stringify(request.id)} }),
      {
        pluginId: ${JSON.stringify(request.id)},
        generation: "test-generation",
        key: ${JSON.stringify(request.id)},
      },
    );
    for (const dispose of effects.reverse()) await dispose();
    expect(remove).toHaveBeenCalledOnce();
  });
});
`;
}

export function scaffoldPlugin(request: PluginCreateRequest): PluginScaffold {
  const descriptor = descriptorFor(request.target);
  if (!descriptor && !providerTargets.has(request.target)) {
    throw new Error(`unknown plugin creation target "${request.target}"`);
  }
  if (
    request.variant !== undefined &&
    (!descriptor?.variants ||
      !(descriptor.variants as readonly string[]).includes(request.variant))
  ) {
    throw new Error(
      `target "${request.target}" does not declare variant "${request.variant}"`,
    );
  }
  const isMain = request.target === "main-provider" || request.target === "server";
  const entrypoint = isMain ? "src/main.ts" : "src/renderer.ts";
  const pluginDependencies = dependencies(descriptor, request);
  const manifest: TermcoPluginManifestV3 = {
    schemaVersion: 3,
    id: request.id,
    name: request.name,
    description: request.description,
    category: request.category,
    version: "1.0.0",
    entrypoints: isMain ? { main: entrypoint } : { renderer: entrypoint },
    ...(request.target === "server"
      ? {
          assetBuilds: [{
            entry: "src/server.ts",
            output: "assets/server/plugin-server.mjs",
            platform: "node" as const,
            target: "node18",
          }],
        }
      : {}),
    dependencies: pluginDependencies,
    activation: "eager",
  };
  const source = descriptor
    ? contributionSource(request, descriptor)
    : isMain
      ? mainProviderSource
      : rendererProviderSource;
  const modulePath = isMain ? "./main" : "./renderer";
  const testPath = isMain ? "src/main.test.ts" : "src/renderer.test.ts";
  const files = new Map<string, string>([
    [entrypoint, source],
    [testPath, behaviorTestSource(request, modulePath, descriptor)],
    [
      "package.json",
      `${JSON.stringify({
        name: `@termco/plugin-${request.id}`,
        version: manifest.version,
        private: true,
        type: "module",
        dependencies: pluginDependencies,
      }, null, 2)}\n`,
    ],
    ["README.md", `# ${request.name}\n\n${request.description}\n`],
    [
      "AGENTS.md",
      "# Plugin boundary\n\n- Import lifecycle APIs from `@termco/kernel`.\n- Import product contracts from their owning `@termco/*-base` packages.\n- Keep implementation, tests, assets, and cleanup inside this plugin folder.\n",
    ],
  ]);
  if (request.target === "server") {
    files.set(
      "src/server.ts",
      `export const pluginServerId = ${JSON.stringify(request.id)};\n`,
    );
  }
  return { manifest, files };
}

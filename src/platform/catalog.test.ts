import { describe, expect, it } from "vitest";
import { buildPluginCatalog, type PluginCatalogObservations } from "./catalog";
import type { ComposedProfile } from "./composeProfile";
import type { TermcoPluginManifestV3 } from "./contracts";
import { resolvePluginTree } from "./resolve";

function plugin(
  id: string,
  values: Partial<TermcoPluginManifestV3> = {},
): TermcoPluginManifestV3 {
  return {
    schemaVersion: 3,
    id,
    name: id,
    description: `${id} explains what it does`,
    category: "Platform providers",
    version: "1.0.0",
    entrypoints: { main: "src/main.ts" },
    dependencies: {},
    ...values,
  };
}

describe("plugin catalog", () => {
  it("keeps disabled executable rows discoverable for reactivation", () => {
    const disabled = plugin("company.disabled");
    const profile: ComposedProfile = {
      schemaVersion: 3,
      id: "company.app",
      bundles: [],
      plugins: [
        {
          id: "company.disabled.row",
          module: "bundled:plugin-repository/plugins/company-disabled",
          enabled: false,
        },
      ],
      patches: [],
      provenance: { "company.disabled.row": "company.app" },
      layers: ["company.app"],
    };
    const manifests = new Map([["company.disabled.row", disabled]]);
    const tree = resolvePluginTree({ profile, manifests });

    expect(
      buildPluginCatalog(
        profile,
        tree,
        { serviceProviders: new Map(), moduleInjections: new Map() },
        { manifests },
      ),
    ).toEqual([
      expect.objectContaining({
        id: "company.disabled",
        profileRowId: "company.disabled.row",
        enabled: false,
        status: "disabled",
        whyLoaded: "Profile layer “company.app” keeps this plugin disabled.",
      }),
    ]);
  });

  it("projects arbitrary runtime services, privilege labels, and profile provenance without a central catalogue", () => {
    const secrets = plugin("company.secrets-native");
    const chat = plugin("company.chat-ui", {
      name: "Company Chat",
      category: "AI",
      entrypoints: { renderer: "src/renderer.tsx" },
    });
    const profile: ComposedProfile = {
      schemaVersion: 3,
      id: "company.app",
      bundles: [],
      plugins: [
        { id: "secrets.provider", module: "bundled:plugin-repository/plugins/company-secrets" },
        { id: "chat.surface", module: "./plugins/company-chat" },
      ],
      patches: [],
      provenance: {
        "secrets.provider": "termco.default",
        "chat.surface": "company.app",
      },
      layers: ["termco.default", "company.app"],
    };
    const tree = resolvePluginTree({
      profile,
      manifests: new Map([
        ["secrets.provider", secrets],
        ["chat.surface", chat],
      ]),
    });
    const observations: PluginCatalogObservations = {
      serviceProviders: new Map([["company.secrets", ["secrets.provider"]]]),
      moduleInjections: new Map([["chat.surface", ["company.secrets"]]]),
      optionalModuleInjections: new Map([["chat.surface", ["company.telemetry"]]]),
      runtime: {
        process: "renderer",
        fibers: [
          {
            pluginId: "chat.surface",
            state: "pending",
            missingServices: ["company.secrets"],
          },
        ],
        features: [],
      },
      serviceMetadata: new Map([
        [
          "company.secrets",
          {
            version: "1.0.0",
            description: "Company-owned protected secret storage.",
            cardinality: "exclusive",
          },
        ],
      ]),
      privilegeLabels: new Map([
        ["secrets.provider", ["process.main", "secrets"]],
        ["chat.surface", ["ui.render"]],
      ]),
    };

    const catalog = buildPluginCatalog(profile, tree, observations);

    expect(catalog.map((item) => item.category)).toEqual([
      "AI",
      "Platform providers",
    ]);
    expect(catalog.find((item) => item.id === "company.chat-ui")).toMatchObject(
      {
        editable: true,
        selectedBy: "company.app",
        whyLoaded: "Profile layer “company.app” selected this plugin.",
        permissions: ["ui.render"],
        status: "blocked",
        runtime: [
          {
            process: "renderer",
            state: "pending",
            missingServices: ["company.secrets"],
          },
        ],
        consumes: [
          {
            id: "company.secrets",
            providers: ["secrets.provider"],
            description: "Company-owned protected secret storage.",
          },
          {
            id: "company.telemetry",
            optional: true,
          },
        ],
      },
    );
    expect(
      catalog.find((item) => item.id === "company.secrets-native"),
    ).toMatchObject({
      editable: false,
      selectedBy: "termco.default",
      permissions: ["process.main", "secrets"],
      provides: [
        {
          id: "company.secrets",
          version: "1.0.0",
          cardinality: "exclusive",
          providers: ["secrets.provider"],
          description: "Company-owned protected secret storage.",
        },
      ],
    });
  });
});

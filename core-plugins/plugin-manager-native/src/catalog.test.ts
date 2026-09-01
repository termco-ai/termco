import { describe, expect, it } from "vitest";
import type { PluginCatalogItem } from "@termco/profile-base";
import { catalogCategories, groupedCatalog, matchesPlugin } from "./catalog";

const plugin = (values: Partial<PluginCatalogItem>): PluginCatalogItem => ({
  id: "ssh-native",
  name: "Native SSH Runtime",
  description: "Owns the shared connection pool.",
  category: "Remote providers",
  version: "1.0.0",
  sourceFolder: "plugins/ssh-native",
  sourceType: "bundled",
  editable: false,
  userInstalled: false,
  selectedBy: "termco.default",
  whyLoaded: "Selected by the foundation profile.",
  provides: [{
    id: "ssh.client",
    version: "1.0.0",
    description: "Application-wide SSH connections.",
    cardinality: "exclusive",
    providers: ["ssh-native"],
  }],
  consumes: [],
  permissions: ["network"],
  processes: ["main"],
  ...values,
});

describe("plugin manager catalog", () => {
  it("searches names, categories, capabilities, and explanations", () => {
    const item = plugin({});
    expect(matchesPlugin(item, "ssh connections")).toBe(true);
    expect(matchesPlugin(item, "remote network")).toBe(true);
    expect(matchesPlugin(item, "terminal theme")).toBe(false);
  });

  it("groups filtered plugins into stable alphabetical categories", () => {
    const catalog = [
      plugin({}),
      plugin({
        id: "ui-shell",
        name: "Shell",
        category: "Interface",
        description: "Composes the application window.",
        sourceFolder: "plugins/ui-shell",
        whyLoaded: "Selected as the renderer shell.",
        provides: [],
        permissions: ["ui.render"],
      }),
    ];
    expect(catalogCategories(catalog)).toEqual([
      { category: "Interface", count: 1 },
      { category: "Remote providers", count: 1 },
    ]);
    expect(groupedCatalog(catalog, "ssh", null).map((group) => group.category))
      .toEqual(["Remote providers"]);
  });
});

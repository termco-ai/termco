import type { PluginCatalogItem } from "@termco/profile-base";

export const GROUP_ORDER = [
  "Surfaces",
  "Sidebar panels",
  "AI",
  "Chrome & Tools",
  "System",
] as const;

/** Case-insensitive substring matching over any supplied display field. */
export function pluginMatches(
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return fields.some((field) =>
    (field ?? "").toLocaleLowerCase().includes(normalized),
  );
}

export function matchesPlugin(plugin: PluginCatalogItem, query: string): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searchable = [
    plugin.id,
    plugin.name,
    plugin.description,
    plugin.category,
    plugin.sourceFolder,
    plugin.whyLoaded,
    plugin.replaces ?? "",
    ...plugin.permissions,
    ...plugin.provides.flatMap((capability) => [
      capability.id,
      capability.description,
      capability.key ?? "",
    ]),
    ...plugin.consumes.flatMap((capability) => [
      capability.id,
      capability.description,
      ...capability.providers,
    ]),
  ];
  return words.every((word) => pluginMatches(word, searchable));
}

export function filterCatalog(
  catalog: readonly PluginCatalogItem[],
  query: string,
): PluginCatalogItem[] {
  return catalog.filter((plugin) => matchesPlugin(plugin, query));
}

export function groupedCatalog(
  catalog: readonly PluginCatalogItem[],
  query: string,
  category: string | null,
): Array<{ category: string; plugins: PluginCatalogItem[] }> {
  const groups = new Map<string, PluginCatalogItem[]>();
  for (const plugin of catalog) {
    if (category && plugin.category !== category) continue;
    if (!matchesPlugin(plugin, query)) continue;
    const plugins = groups.get(plugin.category) ?? [];
    plugins.push(plugin);
    groups.set(plugin.category, plugins);
  }
  const rank = (value: string) => {
    const index = GROUP_ORDER.indexOf(value as (typeof GROUP_ORDER)[number]);
    return index < 0 ? GROUP_ORDER.length : index;
  };
  return [...groups]
    .sort(([left], [right]) => rank(left) - rank(right) || left.localeCompare(right))
    .map(([group, plugins]) => ({
      category: group,
      plugins: plugins.sort((left, right) => left.name.localeCompare(right.name)),
    }));
}

/** Deterministic global settings-search rows for every visible plugin. */
export function pluginSearchEntries(catalog: readonly PluginCatalogItem[]) {
  const builtins = catalog.filter((plugin) => !plugin.userInstalled);
  const installed = catalog
    .filter((plugin) => plugin.userInstalled)
    .sort((left, right) => left.id.localeCompare(right.id));
  return [...builtins, ...installed].map((plugin) => ({
    title: plugin.name,
    description:
      plugin.description ||
      (plugin.userInstalled
        ? "Installed third-party plugin."
        : "Built-in plugin."),
    keywords: `${plugin.id} ${plugin.category} ${plugin.userInstalled ? "third-party" : "builtin"} plugin`,
  }));
}

export function catalogCategories(catalog: readonly PluginCatalogItem[]) {
  const counts = new Map<string, number>();
  for (const plugin of catalog) {
    counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1);
  }
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

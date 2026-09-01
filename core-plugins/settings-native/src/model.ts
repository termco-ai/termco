import type { UiSettingsSectionContribution } from "@termco/ui-settings-base";

export type SettingsSearchHit = {
  sectionId: string;
  sectionLabel: string;
  title: string;
  description: string;
};

export function orderedSections(
  sections: readonly UiSettingsSectionContribution[],
): UiSettingsSectionContribution[] {
  return [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function sectionGroups(sections: readonly UiSettingsSectionContribution[]) {
  const groups: Array<{
    label: string;
    entries: UiSettingsSectionContribution[];
  }> = [];
  for (const section of sections) {
    const last = groups[groups.length - 1];
    if (last && last.label === section.category) last.entries.push(section);
    else groups.push({ label: section.category, entries: [section] });
  }
  return groups;
}

export function searchSections(sections: readonly UiSettingsSectionContribution[], query: string): SettingsSearchHit[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return sections.flatMap((section) => section.searchEntries.flatMap((entry) =>
    `${entry.title} ${entry.description} ${entry.keywords ?? ""} ${section.label} ${section.category}`.toLocaleLowerCase().includes(term)
      ? [{ sectionId: section.id, sectionLabel: section.label, title: entry.title, description: entry.description }]
      : [],
  ));
}

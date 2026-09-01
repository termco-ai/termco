import { describe, expect, it } from "vitest";
import type { UiSettingsSectionContribution } from "@termco/ui-settings-base";
import { orderedSections, searchSections, sectionGroups } from "./model";

const section = (id: string, category: string, description = "") => ({
  id,
  label: id,
  description,
  category,
  Component: () => null,
  searchEntries: [{ title: `${id} option`, description, keywords: "hidden-term" }],
}) satisfies UiSettingsSectionContribution;

describe("settings application model", () => {
  it("orders capability contributions by declared order and label", () => {
    expect(
      orderedSections([
        { ...section("terminal", "Workspace"), order: 20 },
        { ...section("models", "AI"), order: 10 },
      ]).map((entry) => entry.id),
    ).toEqual(["models", "terminal"]);
  });
  it("groups categories and searches descriptions and hidden terms", () => {
    const sections = [section("models", "AI", "Select a default model"), section("terminal", "Workspace")];
    expect(sectionGroups(sections).map((group) => group.label)).toEqual(["AI", "Workspace"]);
    expect(searchSections(sections, "default model").map((hit) => hit.sectionId)).toEqual(["models"]);
    expect(searchSections(sections, "hidden-term")).toHaveLength(2);
  });
});

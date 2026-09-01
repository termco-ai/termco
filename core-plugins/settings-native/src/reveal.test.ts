// @vitest-environment jsdom
import type { UiSettingsViewCapability } from "@termco/ui-settings-base";
import type { UiContributionRef } from "@termco/ui-shell-base";
import { describe, expect, it, vi } from "vitest";
import { createSettingsRevealAdapter } from "./renderer";

const target: UiContributionRef = {
  service: "ui.settings.sections",
  pluginId: "models-settings",
  generation: "sha256-models-v2",
  key: "models",
  contributionId: "models",
};

describe("Settings change reveal", () => {
  it("opens and returns only the exact owned section heading", async () => {
    const show = vi.fn();
    const state = { show } as unknown as UiSettingsViewCapability;
    document.body.innerHTML = `
      <h1
        role="heading"
        data-plugin-owner="other-settings"
        data-plugin-generation="sha256-other"
        data-contribution-service="ui.settings.sections"
        data-contribution-key="models"
      >Models</h1>
      <h1
        role="heading"
        data-plugin-owner="models-settings"
        data-plugin-generation="sha256-models-v2"
        data-contribution-service="ui.settings.sections"
        data-contribution-key="models"
      >Models</h1>
    `;

    const result = await createSettingsRevealAdapter(state, document).reveal({
      target,
      mode: "show-and-spotlight",
      announcement: "Models settings were added.",
    });

    expect(show).toHaveBeenCalledWith("models");
    expect(result).toMatchObject({
      status: "revealed",
      element: document.querySelectorAll("h1")[1],
    });
  });
});

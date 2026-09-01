// @vitest-environment jsdom
import type { UiContributionRef } from "@termco/ui-shell-base";
import { describe, expect, it } from "vitest";
import { createShellRevealAdapter } from "./reveal";

const target: UiContributionRef = {
  service: "ui.statusbar.items",
  pluginId: "company-build-status",
  generation: "sha256-build-v3",
  key: "build-status",
  contributionId: "build-status",
};

describe("shell-owned change reveal adapter", () => {
  it("returns only the exact owned mounted generation", async () => {
    document.body.innerHTML = `
      <div
        data-plugin-owner="other-plugin"
        data-plugin-generation="sha256-other"
        data-contribution-service="ui.statusbar.items"
        data-contribution-key="build-status"
      ><button>Build status</button></div>
      <div
        data-plugin-owner="company-build-status"
        data-plugin-generation="sha256-build-v3"
        data-contribution-service="ui.statusbar.items"
        data-contribution-key="build-status"
      ><button>Build status</button></div>
    `;
    const exactRoot = document.querySelectorAll<HTMLElement>(
      "[data-plugin-owner]",
    )[1];

    await expect(createShellRevealAdapter(document).reveal({
      target,
      mode: "spotlight",
      announcement: "Build status was added to the status bar.",
    })).resolves.toMatchObject({
      status: "revealed",
      target,
      element: exactRoot,
    });
  });

  it("does not fall back to another plugin or generation", async () => {
    document.body.innerHTML = `
      <div
        data-plugin-owner="company-build-status"
        data-plugin-generation="sha256-build-v2"
        data-contribution-service="ui.statusbar.items"
        data-contribution-key="build-status"
      >Old build status</div>
    `;

    await expect(createShellRevealAdapter(document).reveal({
      target,
      mode: "spotlight",
      announcement: "Build status was added to the status bar.",
    })).resolves.toMatchObject({ status: "not-found", target });
  });
});

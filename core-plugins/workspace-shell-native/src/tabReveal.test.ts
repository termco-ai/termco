// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { UiSidebarNavigationCapability } from "@termco/ui-sidebar-base";
import { createSidebarRevealAdapter } from "./renderer";

const request = {
  target: {
    pluginId: "notes-tabs",
    generation: "sha256-notes",
    service: "ui.tabs.kinds" as const,
    key: "notes-tabs",
    contributionId: "notes-tabs",
  },
  mode: "show-and-spotlight" as const,
  announcement: "Notes tab is ready.",
};

describe("tab-kind reveal", () => {
  it("reveals only an already-open exact owned tab and never invents sample data", async () => {
    const navigation = { show: vi.fn() } as unknown as UiSidebarNavigationCapability;
    const adapter = createSidebarRevealAdapter(navigation);
    const surface = document.createElement("div");
    surface.dataset.pluginOwner = "notes-tabs";
    surface.dataset.pluginGeneration = "sha256-notes";
    surface.dataset.contributionService = "ui.tabs.kinds";
    surface.dataset.contributionKey = "notes-tabs";
    surface.setAttribute("aria-hidden", "false");
    document.body.append(surface);

    await expect(adapter.reveal(request)).resolves.toMatchObject({
      status: "revealed",
      element: surface,
    });
    expect(navigation.show).not.toHaveBeenCalled();

    surface.setAttribute("aria-hidden", "true");
    await expect(adapter.reveal(request)).resolves.toMatchObject({
      status: "not-found",
      message: expect.stringContaining("no safe deterministic sample"),
    });
    expect(navigation.show).not.toHaveBeenCalled();
  });
});

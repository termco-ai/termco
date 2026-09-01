import { UI_CHANGE_REVEAL_ADAPTERS_SERVICE } from "@termco/ui-change-reveal-base";
import { describe, expect, it } from "vitest";
import plugin from "./renderer";

describe("workspace reveal dependency", () => {
  it("keeps the workspace shell active when the optional reveal provider is disabled", () => {
    expect(plugin.inject).not.toContain(UI_CHANGE_REVEAL_ADAPTERS_SERVICE);
    expect(plugin.optionalInject).toContain(UI_CHANGE_REVEAL_ADAPTERS_SERVICE);
  });
});

import { describe, expect, it } from "vitest";
import { describePluginSource } from "./sourceDescriptor";

describe("official plugin source descriptors", () => {
  it("keeps independently released product plugins immutable", () => {
    expect(
      describePluginSource(
        "official:/user/plugin-platform/official-plugins/release/plugins/preview-surface-native",
      ),
    ).toEqual({
      type: "bundled",
      module:
        "official:/user/plugin-platform/official-plugins/release/plugins/preview-surface-native",
      location:
        "/user/plugin-platform/official-plugins/release/plugins/preview-surface-native",
    });
  });
});

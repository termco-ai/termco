import { describe, expect, it } from "vitest";
import { composeProfile, type ProfileBundleV3 } from "./composeProfile";
import type { ProfilePluginRowV3, TermcoProfileV3 } from "./contracts";

function profile(
  id: string,
  values: Partial<TermcoProfileV3> = {},
): TermcoProfileV3 {
  return {
    schemaVersion: 3,
    id,
    bundles: [],
    plugins: [],
    patches: [],
    ...values,
  };
}

const row = (
  id: string,
  module = `@termco-plugin/${id}`,
): ProfilePluginRowV3 => ({ id, module });

describe("composeProfile", () => {
  it("resolves nested bundles before later bundles and the active profile", () => {
    const active = profile("company.desktop", {
      bundles: ["company.base", "company.extras"],
      plugins: [row("company-shell")],
    });
    const bundles = new Map<string, ProfileBundleV3>([
      ["termco.base", { id: "termco.base", plugins: [row("storage-native")] }],
      [
        "company.base",
        {
          id: "company.base",
          bundles: ["termco.base"],
          plugins: [row("company-audit")],
        },
      ],
      [
        "company.extras",
        { id: "company.extras", plugins: [row("company-theme")] },
      ],
    ]);

    const composed = composeProfile(
      active.id,
      new Map([[active.id, active]]),
      bundles,
    );

    expect(composed.layers).toEqual([
      "termco.base",
      "company.base",
      "company.extras",
      "company.desktop",
    ]);
    expect(composed.plugins.map((plugin) => plugin.id)).toEqual([
      "storage-native",
      "company-audit",
      "company-theme",
      "company-shell",
    ]);
    expect(composed.provenance).toEqual({
      "storage-native": "termco.base",
      "company-audit": "company.base",
      "company-theme": "company.extras",
      "company-shell": "company.desktop",
    });
  });

  it("rejects a missing bundle", () => {
    const active = profile("company.desktop", {
      bundles: ["company.missing"],
    });

    expect(() =>
      composeProfile(active.id, new Map([[active.id, active]]), new Map()),
    ).toThrow('bundle "company.missing" does not exist');
  });

  it("rejects recursive bundle cycles with the cycle path", () => {
    const active = profile("company.desktop", { bundles: ["bundle.a"] });
    const bundles = new Map<string, ProfileBundleV3>([
      ["bundle.a", { id: "bundle.a", bundles: ["bundle.b"], plugins: [] }],
      ["bundle.b", { id: "bundle.b", bundles: ["bundle.a"], plugins: [] }],
    ]);

    expect(() =>
      composeProfile(active.id, new Map([[active.id, active]]), bundles),
    ).toThrow("bundle cycle: bundle.a -> bundle.b -> bundle.a");
  });

  it("rejects duplicate stable row ids instead of silently overriding order", () => {
    const active = profile("company.desktop", {
      bundles: ["termco.base"],
      plugins: [row("ssh-runtime", "@company/ssh")],
    });
    const bundles = new Map<string, ProfileBundleV3>([
      [
        "termco.base",
        { id: "termco.base", plugins: [row("ssh-runtime", "@termco/ssh")] },
      ],
    ]);

    expect(() =>
      composeProfile(active.id, new Map([[active.id, active]]), bundles),
    ).toThrow(
      'profile layer "company.desktop" inserts duplicate row "ssh-runtime" from "termco.base"',
    );
  });

  it("rejects a missing active profile", () => {
    expect(() => composeProfile("missing.profile", new Map())).toThrow(
      'profile "missing.profile" does not exist',
    );
  });
});

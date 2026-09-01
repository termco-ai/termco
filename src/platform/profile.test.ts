import { describe, expect, it } from "vitest";
import { parseProfileV3 } from "./profile";

const base = {
  schemaVersion: 3,
  id: "company.desktop",
  bundles: ["termco-base", "termco-desktop"],
  plugins: [{ id: "company.counter", module: "@company/counter-provider" }],
} as const;

describe("ordered profile source configuration", () => {
  it("preserves insert, disable, remove, and replace patches", () => {
    const profile = {
      ...base,
      patches: [
        {
          op: "insert",
          plugin: { id: "company.audit", module: "@company/audit" },
          after: "company.counter",
        },
        { op: "disable", target: "company.audit" },
        { op: "remove", target: "company.audit" },
        {
          op: "replace",
          target: "company.counter",
          plugin: {
            id: "company.counter",
            module: "@company/counter-provider-next",
          },
        },
      ],
    } as const;

    expect(parseProfileV3(profile)).toEqual({ ok: true, profile });
  });

  it("rejects an insert with competing position anchors", () => {
    expect(
      parseProfileV3({
        ...base,
        patches: [
          {
            op: "insert",
            plugin: { id: "company.audit", module: "@company/audit" },
            before: "company.counter",
            after: "company.counter",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "patches.0: insert accepts only one of before or after",
    });
  });

  it("rejects replacement that changes the stable row id", () => {
    expect(
      parseProfileV3({
        ...base,
        patches: [
          {
            op: "replace",
            target: "company.counter",
            plugin: {
              id: "company.counter-renamed",
              module: "@company/counter-provider-next",
            },
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "patches.0.plugin.id: replacement must preserve the target row id",
    });
  });
});

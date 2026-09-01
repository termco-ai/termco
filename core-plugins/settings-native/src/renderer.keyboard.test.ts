import { describe, expect, it } from "vitest";
import { isUnhandledSettingsEscape } from "./keyboard";

describe("settings keyboard ownership", () => {
  it("leaves an Escape handled by a nested overlay alone", () => {
    expect(
      isUnhandledSettingsEscape({ key: "Escape", defaultPrevented: true }),
    ).toBe(false);
  });

  it("handles only an otherwise-unclaimed Escape", () => {
    expect(
      isUnhandledSettingsEscape({ key: "Escape", defaultPrevented: false }),
    ).toBe(true);
    expect(
      isUnhandledSettingsEscape({ key: "Enter", defaultPrevented: false }),
    ).toBe(false);
  });
});

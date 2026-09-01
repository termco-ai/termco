import { describe, expect, it } from "vitest";
import { createSettingsViewState } from "./state";

describe("settings view state", () => {
  it("shares deep-link navigation and toggle state", () => {
    const state = createSettingsViewState();
    state.show("models");
    expect(state.snapshot()).toMatchObject({ open: true, requestedSection: "models", openSequence: 1 });
    state.toggle();
    expect(state.snapshot().open).toBe(false);
    state.toggle("languages");
    expect(state.snapshot()).toMatchObject({ open: true, requestedSection: "languages", openSequence: 2 });
  });
});

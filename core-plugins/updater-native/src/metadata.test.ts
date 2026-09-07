import { describe, expect, it } from "vitest";
import { toUpdateMetadata } from "./metadata";

describe("update metadata", () => {
  it("returns null when no newer version is reported", () => {
    expect(toUpdateMetadata(undefined, "1.0.0")).toBeNull();
    expect(toUpdateMetadata({ version: "1.0.0" }, "1.0.0")).toBeNull();
  });

  it("preserves textual release details", () => {
    expect(toUpdateMetadata({ version: "2.0.0", releaseDate: "2026-08-18", releaseNotes: "Changes" }, "1.0.0")).toEqual({
      available: true,
      version: "2.0.0",
      currentVersion: "1.0.0",
      date: "2026-08-18",
      body: "Changes",
    });
  });

  it("converts the HTML returned by electron-updater into readable release notes", () => {
    expect(toUpdateMetadata({
      version: "2.0.0",
      releaseNotes: [
        "<p>• First change<br>• Second &amp; safer change</p>",
        "<p>Requires Termco 2.0 or newer.</p>",
      ].join(""),
    }, "1.0.0")).toEqual({
      available: true,
      version: "2.0.0",
      currentVersion: "1.0.0",
      body: [
        "• First change",
        "• Second & safer change",
        "",
        "Requires Termco 2.0 or newer.",
      ].join("\n"),
    });
  });

  it("does not expose structured release notes through the string contract", () => {
    expect(toUpdateMetadata({ version: "2.0.0", releaseNotes: [{ note: "x" }] }, "1.0.0")).toEqual({
      available: true,
      version: "2.0.0",
      currentVersion: "1.0.0",
    });
  });
});

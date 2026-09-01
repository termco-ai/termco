import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWithPlatform(value: string | Error) {
  vi.resetModules();
  vi.doMock("@/native/os", () => ({
    platform: () => {
      if (value instanceof Error) throw value;
      return value;
    },
  }));
  return import("./platform");
}

afterEach(() => {
  vi.doUnmock("@/native/os");
  vi.resetModules();
});

describe("platform flags", () => {
  it("detects macOS", async () => {
    const p = await loadWithPlatform("macos");
    expect(p.IS_MAC).toBe(true);
    expect(p.IS_LINUX).toBe(false);
    expect(p.IS_WINDOWS).toBe(false);
    expect(p.USE_CUSTOM_WINDOW_CONTROLS).toBe(false);
    expect(p.MOD_KEY).toBe("⌘");
    expect(p.MOD_PROP).toBe("meta");
    expect(p.KEY_SEP).toBe("");
  });

  it("detects Linux and enables custom window controls", async () => {
    const p = await loadWithPlatform("linux");
    expect(p.IS_LINUX).toBe(true);
    expect(p.IS_MAC).toBe(false);
    expect(p.USE_CUSTOM_WINDOW_CONTROLS).toBe(true);
    expect(p.MOD_KEY).toBe("Ctrl");
    expect(p.MOD_PROP).toBe("ctrl");
    expect(p.KEY_SEP).toBe("+");
  });

  it("detects Windows and enables custom window controls", async () => {
    const p = await loadWithPlatform("windows");
    expect(p.IS_WINDOWS).toBe(true);
    expect(p.USE_CUSTOM_WINDOW_CONTROLS).toBe(true);
  });

  it("falls back to no platform when detection throws", async () => {
    const p = await loadWithPlatform(new Error("no native bridge"));
    expect(p.IS_MAC).toBe(false);
    expect(p.IS_LINUX).toBe(false);
    expect(p.IS_WINDOWS).toBe(false);
    // Unknown platform must not render custom window controls.
    expect(p.USE_CUSTOM_WINDOW_CONTROLS).toBe(false);
  });
});

describe("fmtShortcut", () => {
  it("joins with + off macOS", async () => {
    const p = await loadWithPlatform("linux");
    expect(p.fmtShortcut("Ctrl", "K")).toBe("Ctrl+K");
  });

  it("joins without separator on macOS", async () => {
    const p = await loadWithPlatform("macos");
    expect(p.fmtShortcut("⌘", "K")).toBe("⌘K");
  });
});

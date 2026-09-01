// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FALLBACK = '"JetBrains Mono", SFMono-Regular, Menlo, monospace';

type FontsStub = {
  load?: (font: string) => Promise<unknown>;
  check?: (font: string) => boolean;
};

function setFonts(fonts: FontsStub | undefined) {
  Object.defineProperty(document, "fonts", {
    value: fonts,
    configurable: true,
  });
}

async function freshFonts() {
  vi.resetModules();
  return import("./fonts");
}

beforeEach(() => {
  setFonts(undefined);
});

afterEach(() => {
  setFonts(undefined);
});

describe("ensureMonoFontsLoaded", () => {
  it("resolves immediately when the Font Loading API is missing", async () => {
    const { ensureMonoFontsLoaded } = await freshFonts();
    await expect(ensureMonoFontsLoaded()).resolves.toBeUndefined();
  });

  it("preloads both JetBrains Mono weights once", async () => {
    const load = vi.fn().mockResolvedValue([]);
    setFonts({ load });
    const { ensureMonoFontsLoaded } = await freshFonts();
    await ensureMonoFontsLoaded();
    expect(load).toHaveBeenCalledWith('400 14px "JetBrains Mono"');
    expect(load).toHaveBeenCalledWith('700 14px "JetBrains Mono"');
    expect(load).toHaveBeenCalledTimes(2);

    // The promise is cached: further calls do not re-load.
    await ensureMonoFontsLoaded();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("settles even when a font fails to load", async () => {
    const load = vi.fn().mockRejectedValue(new Error("missing"));
    setFonts({ load });
    const { ensureMonoFontsLoaded } = await freshFonts();
    await expect(ensureMonoFontsLoaded()).resolves.toBeUndefined();
  });
});

describe("detectMonoFontFamily", () => {
  it("falls back when the FontFaceSet API is unavailable", async () => {
    const { detectMonoFontFamily } = await freshFonts();
    expect(detectMonoFontFamily()).toBe(FALLBACK);
  });

  it("returns the first installed Nerd Font candidate", async () => {
    const check = vi.fn((spec: string) => spec === '12px "FiraCode Nerd Font"');
    setFonts({ check });
    const { detectMonoFontFamily } = await freshFonts();
    expect(detectMonoFontFamily()).toBe(`"FiraCode Nerd Font", ${FALLBACK}`);
  });

  it("caches the detection result", async () => {
    const check = vi.fn().mockReturnValue(true);
    setFonts({ check });
    const { detectMonoFontFamily } = await freshFonts();
    detectMonoFontFamily();
    detectMonoFontFamily();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("falls back when no candidate is installed", async () => {
    setFonts({ check: () => false });
    const { detectMonoFontFamily } = await freshFonts();
    expect(detectMonoFontFamily()).toBe(FALLBACK);
  });

  it("ignores browsers that throw on font checks", async () => {
    setFonts({
      check: () => {
        throw new Error("bad shorthand");
      },
    });
    const { detectMonoFontFamily } = await freshFonts();
    expect(detectMonoFontFamily()).toBe(FALLBACK);
  });

  it("backs resolveFontFamily for empty input", async () => {
    const check = vi.fn((spec: string) => spec === '12px "Hack Nerd Font"');
    setFonts({ check });
    const { resolveFontFamily } = await freshFonts();
    expect(resolveFontFamily("  ")).toBe(`"Hack Nerd Font", ${FALLBACK}`);
  });
});

/**
 * The runtime shim is interpolated into a JS module served to plugin code, so
 * its specifier guard is a boundary, not cosmetics. It also has to agree with
 * the reserved-host parsing in pluginScheme.
 */
import { describe, expect, it } from "vitest";
import {
  isSafeRuntimeSpecifier,
  RUNTIME_HOST,
  runtimeShimSource,
  runtimeSpecifierFromUrl,
} from "./runtimeShim";

describe("isSafeRuntimeSpecifier", () => {
  it("accepts the shapes the registry uses", () => {
    for (const ok of [
      "react",
      "react-dom",
      "@tanstack/react-virtual",
      "@hugeicons/core-free-icons",
      "ui/dropdown-menu",
      "workspace/files",
    ]) {
      expect(isSafeRuntimeSpecifier(ok), ok).toBe(true);
    }
  });

  it("refuses anything that could break out of the string or the map", () => {
    for (const bad of [
      "",
      '";alert(1);//',
      "app/../../secret",
      "..",
      "app/..",
      "with space",
      "back\\slash",
      "new\nline",
      "a".repeat(201),
    ]) {
      expect(isSafeRuntimeSpecifier(bad), bad).toBe(false);
    }
  });
});

describe("runtimeShimSource", () => {
  it("emits a default-only module that resolves the live instance", () => {
    const src = runtimeShimSource("react") as string;
    expect(src).toContain("globalThis.__termcoRuntime");
    expect(src).toContain('registry["react"]');
    expect(src).toContain("export default await load()");
    // Named exports are deliberately NOT emitted (see the module docstring).
    expect(src).not.toMatch(/export const/);
  });

  it("teaches the fix when the module or the runtime is missing", () => {
    const src = runtimeShimSource("ui/dropdown-menu") as string;
    expect(src).toContain("before the app finished booting");
    expect(src).toContain("src/core/runtime/registry.ts");
  });

  it("returns null for an unsafe specifier", () => {
    expect(runtimeShimSource('";alert(1)//')).toBeNull();
    expect(runtimeShimSource("app/../etc")).toBeNull();
  });
});

describe("runtimeSpecifierFromUrl", () => {
  it("extracts the specifier from the reserved host", () => {
    expect(runtimeSpecifierFromUrl("termco-plugin://__runtime/react")).toBe(
      "react",
    );
    expect(
      runtimeSpecifierFromUrl("termco-plugin://__runtime/app/lib/utils"),
    ).toBe("app/lib/utils");
  });

  it("tolerates an explicit .js and a query string", () => {
    expect(runtimeSpecifierFromUrl("termco-plugin://__runtime/react.js")).toBe(
      "react",
    );
    expect(
      runtimeSpecifierFromUrl("termco-plugin://__runtime/react?v=1"),
    ).toBe("react");
  });

  it("returns null for real plugin hosts (so file serving still runs)", () => {
    expect(runtimeSpecifierFromUrl("termco-plugin://my-plugin/main.js")).toBeNull();
    expect(runtimeSpecifierFromUrl("https://example.com/x.js")).toBeNull();
  });

  it("the reserved host can never be a valid plugin id", () => {
    // PLUGIN_ID_RE (pluginScheme.ts) forbids underscores.
    expect(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(RUNTIME_HOST)).toBe(false);
  });
});

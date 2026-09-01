import type { HttpCapability } from "@termco/http-base";
import { describe, expect, it, vi } from "vitest";
import { checkLinuxRelease, isNewer, parseVersion } from "./releaseCheck";

function httpResponse(status: number, value: unknown): HttpCapability {
  return {
    ping: async () => status,
    request: vi.fn(async () => ({
      status,
      headers: {},
      body: [...new TextEncoder().encode(JSON.stringify(value))],
    })),
    stream: async () => async () => {},
  };
}

describe("parseVersion", () => {
  it("parses dotted versions, strips v, ignores prereleases, and coerces bad parts", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("v0.10.1")).toEqual([0, 10, 1]);
    expect(parseVersion("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersion("1.x.3")).toEqual([1, 0, 3]);
  });
});

describe("isNewer", () => {
  it("compares component-wise, handles equality, and pads missing parts", () => {
    expect(isNewer("1.2.4", "1.2.3")).toBe(true);
    expect(isNewer("1.2.3", "1.2.4")).toBe(false);
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("v1.2.3", "1.2.3")).toBe(false);
    expect(isNewer("1.2.0.1", "1.2")).toBe(true);
    expect(isNewer("1.2", "1.2.0")).toBe(false);
  });
});

describe("checkLinuxRelease", () => {
  it("returns complete update information for a newer release", async () => {
    const http = httpResponse(200, {
      tag_name: "v1.1.0",
      body: "notes",
      html_url: "https://github.com/termco-ai/termco/releases/tag/v1.1.0",
    });
    await expect(checkLinuxRelease(http, "1.0.0")).resolves.toEqual({
      version: "1.1.0",
      currentVersion: "1.0.0",
      body: "notes",
      releaseUrl:
        "https://github.com/termco-ai/termco/releases/tag/v1.1.0",
    });
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.github.com/repos/termco-ai/termco/releases/latest",
      }),
    );
  });

  it("returns null when current and defaults a missing body", async () => {
    await expect(
      checkLinuxRelease(
        httpResponse(200, { tag_name: "v1.1.0", html_url: "u" }),
        "1.1.0",
      ),
    ).resolves.toBeNull();
    await expect(
      checkLinuxRelease(
        httpResponse(200, { tag_name: "v2.0.0", html_url: "u" }),
        "1.0.0",
      ),
    ).resolves.toMatchObject({ body: "" });
  });

  it("throws on a non-success GitHub response", async () => {
    await expect(
      checkLinuxRelease(httpResponse(403, {}), "1.0.0"),
    ).rejects.toThrow("GitHub API 403");
  });
});

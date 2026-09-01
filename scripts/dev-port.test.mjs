import { describe, expect, it } from "vitest";
import { resolveDevPort } from "./dev-port.mjs";

describe("development renderer port", () => {
  it("keeps the established default", () => {
    expect(resolveDevPort({})).toBe(1420);
  });

  it("supports isolated parallel workspaces", () => {
    expect(resolveDevPort({ TERMCO_VITE_PORT: "1421" })).toBe(1421);
  });

  it.each(["0", "65536", "abc", "1420.5"])(
    "rejects invalid port %s",
    (value) => {
      expect(() => resolveDevPort({ TERMCO_VITE_PORT: value })).toThrow(
        "Invalid TERMCO_VITE_PORT",
      );
    },
  );
});

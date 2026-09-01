import { describe, expect, it } from "vitest";
import { contentTypeFor } from "./contentType";

describe("contentTypeFor", () => {
  it("maps renderer module and asset types", () => {
    expect(contentTypeFor("/x/main.js")).toBe("text/javascript");
    expect(contentTypeFor("/x/manifest.json")).toBe("application/json");
    expect(contentTypeFor("/x/theme.css")).toBe("text/css");
  });

  it("defaults unknown extensions to octet-stream", () => {
    expect(contentTypeFor("/x/data.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("/x/noext")).toBe("application/octet-stream");
  });
});

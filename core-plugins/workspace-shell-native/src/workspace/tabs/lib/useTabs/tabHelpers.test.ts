import { describe, expect, it } from "vitest";
import { basename, titleFromUrl } from "./tabHelpers";

describe("basename", () => {
  it("returns the last segment of a unix path", () => {
    expect(basename("/Users/me/projects/termco-ai")).toBe("termco-ai");
  });

  it("returns the last segment of a windows path", () => {
    expect(basename("C:\\Users\\me\\proj")).toBe("proj");
  });

  it("ignores trailing separators", () => {
    expect(basename("/a/b/")).toBe("b");
    expect(basename("C:\\a\\b\\")).toBe("b");
  });

  it("handles mixed separators", () => {
    expect(basename("C:/Users\\me/proj")).toBe("proj");
  });

  it("returns the input when there is no segment", () => {
    expect(basename("")).toBe("");
    expect(basename("/")).toBe("/");
  });

  it("returns a bare name unchanged", () => {
    expect(basename("file.txt")).toBe("file.txt");
  });
});

describe("titleFromUrl", () => {
  it("returns the host of a valid url", () => {
    expect(titleFromUrl("http://localhost:5173/x")).toBe("localhost:5173");
    expect(titleFromUrl("https://example.com/path?q=1")).toBe("example.com");
  });

  it("falls back to the raw input for a hostless url", () => {
    expect(titleFromUrl("file:///a/b")).toBe("file:///a/b");
  });

  it("returns the raw input when parsing fails", () => {
    expect(titleFromUrl("not a url")).toBe("not a url");
  });

  it("returns 'preview' for an empty string", () => {
    expect(titleFromUrl("")).toBe("preview");
  });
});


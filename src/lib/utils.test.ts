import { describe, expect, it } from "vitest";
import { cn, isMarkdownPath } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("lets later tailwind utilities win over earlier conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ a: true, b: false }, "c")).toBe("a c");
  });
});

describe("isMarkdownPath", () => {
  it("accepts md, markdown, and mdx extensions", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("doc.markdown")).toBe(true);
    expect(isMarkdownPath("page.mdx")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMarkdownPath("README.MD")).toBe(true);
    expect(isMarkdownPath("doc.Markdown")).toBe(true);
  });

  it("rejects non-markdown paths", () => {
    expect(isMarkdownPath("main.ts")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
    expect(isMarkdownPath("archive.md.zip")).toBe(false);
    expect(isMarkdownPath("")).toBe(false);
  });

  it("matches only the final extension", () => {
    expect(isMarkdownPath("notes.txt.md")).toBe(true);
    expect(isMarkdownPath("dir.md/file.ts")).toBe(false);
  });
});

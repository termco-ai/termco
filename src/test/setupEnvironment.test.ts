// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

describe("browser test environment", () => {
  it("provides the DOM APIs CodeMirror uses for scrolling and measurement", () => {
    expect(Element.prototype.scrollIntoView).toBeTypeOf("function");
    expect(Range.prototype.getClientRects).toBeTypeOf("function");
    expect(Range.prototype.getBoundingClientRect).toBeTypeOf("function");
  });
});

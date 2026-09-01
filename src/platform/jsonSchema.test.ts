// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateJsonSchemaInput } from "./jsonSchema";

describe("public AI tool JSON-Schema validation", () => {
  const schema = {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1 },
      timeout: { type: "integer", minimum: 1, maximum: 300 },
    },
    required: ["command"],
    additionalProperties: false,
  };

  it("accepts a valid object", () => {
    expect(validateJsonSchemaInput(schema, { command: "pwd", timeout: 5 }))
      .toEqual([]);
  });

  it("reports required, type, range, and unknown-property failures", () => {
    expect(validateJsonSchemaInput(schema, { timeout: 0, extra: true }))
      .toEqual([
        "(root).command: is required",
        "(root).timeout: must be at least 1",
        "(root).extra: is not allowed",
      ]);
    expect(validateJsonSchemaInput(schema, { command: 123 }))
      .toEqual(["(root).command: must be a string"]);
  });

  it("enforces maximum array sizes", () => {
    const arraySchema = {
      type: "array",
      maxItems: 2,
      items: { type: "string" },
    };
    expect(validateJsonSchemaInput(arraySchema, ["a", "b"])).toEqual([]);
    expect(validateJsonSchemaInput(arraySchema, ["a", "b", "c"])).toEqual([
      "(root): must contain at most 2 items",
    ]);
  });
});

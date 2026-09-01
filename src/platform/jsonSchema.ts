type Schema = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

/** Validate the deliberately small JSON-Schema subset accepted by public AI
 * tool contributions. This keeps the MCP boundary SDK-independent while still
 * rejecting malformed calls before plugin code executes. */
export function validateJsonSchemaInput(
  schema: Schema,
  value: unknown,
  path = "(root)",
): string[] {
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.some(
      (candidate) =>
        isObject(candidate) &&
        validateJsonSchemaInput(candidate, value, path).length === 0,
    );
    return matches ? [] : [`${path}: does not match any allowed shape`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameValue(item, value))) {
    return [`${path}: must be one of ${schema.enum.map(String).join(", ")}`];
  }
  if ("const" in schema && !sameValue(schema.const, value)) {
    return [`${path}: must equal ${String(schema.const)}`];
  }

  const type = schema.type;
  if (type === "null") return value === null ? [] : [`${path}: must be null`];
  if (type === "string") {
    if (typeof value !== "string") return [`${path}: must be a string`];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      return [`${path}: must contain at least ${schema.minLength} characters`];
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      return [`${path}: must contain at most ${schema.maxLength} characters`];
    }
    return [];
  }
  if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path}: must be a number`];
    if (type === "integer" && !Number.isInteger(value)) return [`${path}: must be an integer`];
    if (typeof schema.minimum === "number" && value < schema.minimum) return [`${path}: must be at least ${schema.minimum}`];
    if (typeof schema.maximum === "number" && value > schema.maximum) return [`${path}: must be at most ${schema.maximum}`];
    return [];
  }
  if (type === "boolean") return typeof value === "boolean" ? [] : [`${path}: must be a boolean`];
  if (type === "array") {
    if (!Array.isArray(value)) return [`${path}: must be an array`];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return [`${path}: must contain at least ${schema.minItems} items`];
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return [`${path}: must contain at most ${schema.maxItems} items`];
    if (!isObject(schema.items)) return [];
    return value.flatMap((item, index) => validateJsonSchemaInput(schema.items as Schema, item, `${path}[${index}]`));
  }
  if (type === "object") {
    if (!isObject(value)) return [`${path}: must be an object`];
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    const errors = required
      .filter((key) => !(key in value))
      .map((key) => `${path}.${key}: is required`);
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isObject(childSchema)) {
        errors.push(...validateJsonSchemaInput(childSchema, child, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: is not allowed`);
      } else if (isObject(schema.additionalProperties)) {
        errors.push(...validateJsonSchemaInput(schema.additionalProperties, child, `${path}.${key}`));
      }
    }
    return errors;
  }
  return [];
}

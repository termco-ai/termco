import { z } from "zod";
import { PROFILE_SCHEMA_VERSION, type TermcoProfileV3 } from "./contracts";

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "must be a namespaced lowercase id");
const moduleSpecifier = z.string().trim().min(1);

const pluginRow = z.strictObject({
  id,
  module: moduleSpecifier,
  enabled: z.boolean().optional(),
  disabledBy: id.optional(),
});

const patch = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("insert"),
    plugin: pluginRow,
    before: id.optional(),
    after: id.optional(),
  }),
  z.strictObject({
    op: z.literal("disable"),
    target: id,
  }),
  z.strictObject({
    op: z.literal("remove"),
    target: id,
  }),
  z.strictObject({
    op: z.literal("replace"),
    target: id,
    plugin: pluginRow,
  }),
]);

const profileSchema = z
  .strictObject({
    schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
    id,
    bundles: z.array(moduleSpecifier),
    plugins: z.array(pluginRow),
    patches: z.array(patch),
  })
  .superRefine((profile, context) => {
    for (const [index, operation] of profile.patches.entries()) {
      if (operation.op === "insert" && operation.before && operation.after) {
        context.addIssue({
          code: "custom",
          path: ["patches", index],
          message: "insert accepts only one of before or after",
        });
      }
      if (
        operation.op === "replace" &&
        operation.plugin.id !== operation.target
      ) {
        context.addIssue({
          code: "custom",
          path: ["patches", index, "plugin", "id"],
          message: "replacement must preserve the target row id",
        });
      }
    }
  });

export type ProfileParseResult =
  | { ok: true; profile: TermcoProfileV3 }
  | { ok: false; error: string };

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function parseProfileV3(input: unknown): ProfileParseResult {
  if (isRecord(input) && input.schemaVersion === 2) {
    return {
      ok: false,
      error:
        "schemaVersion: profile targets the removed v2 architecture and must be ported to schema v3",
    };
  }

  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "profile";
    return {
      ok: false,
      error: `${path}: ${issue?.message ?? "invalid profile"}`,
    };
  }
  return { ok: true, profile: parsed.data };
}

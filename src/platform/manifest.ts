import { z } from "zod";
import {
  PLUGIN_MANIFEST_VERSION,
  type TermcoPluginManifestV3,
} from "./contracts";

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "must be a namespaced lowercase id");
const version = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    "must be an exact semver version",
  );
const entrypoint = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "must stay inside the plugin folder",
  );
const assetOutput = entrypoint.refine(
  (value) => value.startsWith("assets/") && value.endsWith(".mjs"),
  "must be an assets/*.mjs cache path",
);

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(PLUGIN_MANIFEST_VERSION),
  id,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  category: z.string().trim().min(1),
  version,
  entrypoints: z
    .strictObject({
      renderer: entrypoint.optional(),
      main: entrypoint.optional(),
      utility: entrypoint.optional(),
    })
    .refine(
      (entries) => Object.keys(entries).length > 0,
      "requires an entrypoint",
    )
    .optional(),
  assetBuilds: z
    .array(
      z.strictObject({
        entry: entrypoint,
        output: assetOutput,
        platform: z.enum(["node", "browser"]),
        target: z.string().min(1).optional(),
      }),
    )
    .optional(),
  dependencies: z.record(z.string().min(1), z.string().min(1)),
  activation: z.enum(["eager", "lazy"]).optional(),
  forkedFrom: id.optional(),
  replaces: id.optional(),
}).refine(
  (manifest) => !(manifest.forkedFrom && manifest.replaces),
  "forkedFrom and replaces are mutually exclusive",
);

export type ManifestParseResult =
  | { ok: true; manifest: TermcoPluginManifestV3 }
  | { ok: false; error: string };

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function parsePluginManifestV3(input: unknown): ManifestParseResult {
  if (isRecord(input) && input.schemaVersion === 2) {
    return {
      ok: false,
      error:
        "schemaVersion: plugin targets the removed v2 architecture and must be ported to schema v3",
    };
  }

  if (isRecord(input)) {
    for (const field of ["provides", "consumes", "permissions"] as const) {
      if (Object.hasOwn(input, field)) {
        return {
          ok: false,
          error: `${field}: was removed by manifest schema v3`,
        };
      }
    }
  }

  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "manifest";
    return {
      ok: false,
      error: `${path}: ${issue?.message ?? "invalid manifest"}`,
    };
  }
  return { ok: true, manifest: parsed.data };
}

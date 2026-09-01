import type {
  ProfilePatchV3,
  ProfilePluginRowV3,
  TermcoProfileV3,
} from "./contracts";

export class ProfileCompositionError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("\n"));
    this.name = "ProfileCompositionError";
  }
}

export interface ProfileBundleV3 {
  id: string;
  bundles?: string[];
  plugins: ProfilePluginRowV3[];
  patches?: ProfilePatchV3[];
}

export interface ComposedProfile extends TermcoProfileV3 {
  /** Last source layer that inserted or changed each effective row. */
  provenance: Record<string, string>;
  /** Bundle layers in application order, followed by the active profile. */
  layers: string[];
}

interface ProfileLayer {
  id: string;
  plugins: ProfilePluginRowV3[];
  patches: ProfilePatchV3[];
}

function compositionError(message: string): never {
  throw new ProfileCompositionError([message]);
}

function orderedBundleLayers(
  roots: readonly string[],
  bundles: ReadonlyMap<string, ProfileBundleV3>,
): ProfileLayer[] {
  const visiting: string[] = [];
  const visited = new Set<string>();
  const result: ProfileLayer[] = [];

  const visit = (id: string) => {
    const cycleStart = visiting.indexOf(id);
    if (cycleStart !== -1) {
      compositionError(
        `bundle cycle: ${[...visiting.slice(cycleStart), id].join(" -> ")}`,
      );
    }
    if (visited.has(id)) return;

    const bundle = bundles.get(id);
    if (!bundle) compositionError(`bundle "${id}" does not exist`);

    visiting.push(id);
    for (const dependency of bundle.bundles ?? []) visit(dependency);
    visiting.pop();
    visited.add(id);
    result.push({
      id: bundle.id,
      plugins: bundle.plugins,
      patches: bundle.patches ?? [],
    });
  };

  for (const root of roots) visit(root);
  return result;
}

function rowIndex(rows: readonly ProfilePluginRowV3[], id: string): number {
  return rows.findIndex((row) => row.id === id);
}

function requireRow(
  rows: readonly ProfilePluginRowV3[],
  layerId: string,
  operation: ProfilePatchV3["op"],
  target: string,
): number {
  const index = rowIndex(rows, target);
  if (index === -1) {
    compositionError(
      `profile layer "${layerId}" cannot ${operation} missing row "${target}"`,
    );
  }
  return index;
}

function applyLayer(
  layer: ProfileLayer,
  rows: ProfilePluginRowV3[],
  provenance: Record<string, string>,
): void {
  for (const plugin of layer.plugins) {
    if (rowIndex(rows, plugin.id) !== -1) {
      compositionError(
        `profile layer "${layer.id}" inserts duplicate row "${plugin.id}" from "${provenance[plugin.id]}"`,
      );
    }
    rows.push({ ...plugin });
    provenance[plugin.id] = layer.id;
  }

  for (const patch of layer.patches) {
    if (patch.op === "insert") {
      if (rowIndex(rows, patch.plugin.id) !== -1) {
        compositionError(
          `profile layer "${layer.id}" inserts duplicate row "${patch.plugin.id}" from "${provenance[patch.plugin.id]}"`,
        );
      }
      if (patch.before && patch.after) {
        compositionError(
          `profile layer "${layer.id}" insert accepts only one of before or after`,
        );
      }

      const anchor = patch.before ?? patch.after;
      let index = rows.length;
      if (anchor) {
        const anchorIndex = rowIndex(rows, anchor);
        if (anchorIndex === -1) {
          compositionError(
            `profile layer "${layer.id}" cannot insert row "${patch.plugin.id}": anchor "${anchor}" does not exist`,
          );
        }
        index = patch.before ? anchorIndex : anchorIndex + 1;
      }
      rows.splice(index, 0, { ...patch.plugin });
      provenance[patch.plugin.id] = layer.id;
      continue;
    }

    const index = requireRow(rows, layer.id, patch.op, patch.target);
    if (patch.op === "disable") {
      rows[index] = { ...rows[index], enabled: false } as ProfilePluginRowV3;
      provenance[patch.target] = layer.id;
      continue;
    }
    if (patch.op === "remove") {
      rows.splice(index, 1);
      delete provenance[patch.target];
      continue;
    }
    if (patch.plugin.id !== patch.target) {
      compositionError(
        `profile layer "${layer.id}" replacement must preserve row id "${patch.target}"`,
      );
    }
    rows[index] = { ...patch.plugin };
    provenance[patch.target] = layer.id;
  }
}

/** Compose bundle and profile source layers into an ordered runtime plugin tree. */
export function composeProfile(
  activeProfileId: string,
  profiles: ReadonlyMap<string, TermcoProfileV3>,
  bundles: ReadonlyMap<string, ProfileBundleV3> = new Map(),
): ComposedProfile {
  const active = profiles.get(activeProfileId);
  if (!active) compositionError(`profile "${activeProfileId}" does not exist`);

  const layers = orderedBundleLayers(active.bundles, bundles);
  layers.push({
    id: active.id,
    plugins: active.plugins,
    patches: active.patches,
  });

  const plugins: ProfilePluginRowV3[] = [];
  const provenance: Record<string, string> = {};
  for (const layer of layers) applyLayer(layer, plugins, provenance);

  return {
    schemaVersion: 3,
    id: active.id,
    bundles: [...active.bundles],
    plugins,
    patches: [...active.patches],
    provenance,
    layers: layers.map((layer) => layer.id),
  };
}

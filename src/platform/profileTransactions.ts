import type { ProfilePluginRowV3, TermcoProfileV3 } from "./contracts";
import { composeProfile, type ComposedProfile } from "./composeProfile";

export interface ActiveProfileSnapshot {
  profile: ComposedProfile;
  revision: number;
}

export interface ProfileTransactionPreview {
  previous: ActiveProfileSnapshot;
  candidate: ActiveProfileSnapshot;
  changedPlugins: string[];
}

export interface ProfileTransactionRequest {
  actor: string;
  profile: TermcoProfileV3;
}

export type CommitProfileCandidate = (
  request: ProfileTransactionRequest,
  preview: ProfileTransactionPreview,
) => Promise<void>;

function rowsById(
  rows: readonly ProfilePluginRowV3[],
): Map<string, ProfilePluginRowV3> {
  return new Map(rows.map((row) => [row.id, row]));
}

function changedPluginIds(
  previous: readonly ProfilePluginRowV3[],
  candidate: readonly ProfilePluginRowV3[],
): string[] {
  const previousById = rowsById(previous);
  const candidateById = rowsById(candidate);
  return [...new Set([...previousById.keys(), ...candidateById.keys()])]
    .filter(
      (id) =>
        JSON.stringify(previousById.get(id)) !==
        JSON.stringify(candidateById.get(id)),
    )
    .sort();
}

/** Atomic configuration transaction for the ordered v3 plugin tree. Runtime
 * candidate loading and activation happen in the supplied commit callback;
 * this manager publishes the new profile only after that callback succeeds. */
export class ProfileTransactionManager {
  readonly #profiles: Map<string, TermcoProfileV3>;
  readonly #listeners = new Set<(snapshot: ActiveProfileSnapshot) => void>();
  #active: ActiveProfileSnapshot;

  constructor(input: {
    activeProfileId: string;
    profiles: Map<string, TermcoProfileV3>;
    activeSnapshot?: ActiveProfileSnapshot;
  }) {
    this.#profiles = new Map(input.profiles);
    this.#active =
      input.activeSnapshot ??
      ({
        profile: composeProfile(input.activeProfileId, this.#profiles),
        revision: 1,
      } satisfies ActiveProfileSnapshot);
  }

  get active(): ActiveProfileSnapshot {
    return this.#active;
  }

  subscribe(listener: (snapshot: ActiveProfileSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  preview(request: ProfileTransactionRequest): ProfileTransactionPreview {
    const profiles = new Map(this.#profiles);
    profiles.set(request.profile.id, request.profile);
    const profile = composeProfile(request.profile.id, profiles);
    return {
      previous: this.#active,
      candidate: {
        profile,
        revision: this.#active.revision + 1,
      },
      changedPlugins: changedPluginIds(
        this.#active.profile.plugins,
        profile.plugins,
      ),
    };
  }

  async apply(
    request: ProfileTransactionRequest,
    commitCandidate: CommitProfileCandidate,
  ): Promise<ActiveProfileSnapshot> {
    const preview = this.preview(request);
    await commitCandidate(request, preview);
    this.#profiles.set(request.profile.id, request.profile);
    this.#active = preview.candidate;
    for (const listener of [...this.#listeners]) listener(this.#active);
    return this.#active;
  }
}

export interface GenerationConfirmation {
  previewId: string;
  generation: number;
}

interface PreviewRecord {
  pluginId: string;
  enabled: boolean;
  generation: number;
}

/** Single-use, generation-stamped authorization for a profile mutation. */
export class PluginEnablePreviewRegistry {
  readonly #previews = new Map<string, PreviewRecord>();
  #generation = 1;

  get generation(): number {
    return this.#generation;
  }

  issue(
    pluginId: string,
    enabled: boolean,
    previewId: string,
  ): GenerationConfirmation {
    this.#previews.set(previewId, {
      pluginId,
      enabled,
      generation: this.#generation,
    });
    return { previewId, generation: this.#generation };
  }

  consume(
    pluginId: string,
    enabled: boolean,
    confirmation: GenerationConfirmation,
  ): void {
    const preview = this.#previews.get(confirmation.previewId);
    if (
      !preview ||
      preview.generation !== this.#generation ||
      confirmation.generation !== this.#generation ||
      preview.pluginId !== pluginId ||
      preview.enabled !== enabled
    ) {
      throw new Error(
        "plugin impact preview is stale; review the current impact and try again",
      );
    }
    this.#previews.delete(confirmation.previewId);
  }

  advance(): void {
    this.#generation += 1;
    this.#previews.clear();
  }
}

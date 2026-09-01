import type { ContributionOwner, Dispose } from "@termco/kernel";
import type { UiContributionCapability } from "@termco/ui-shell-base";
import type { UiTabKindContribution } from "@termco/ui-tabs-base";

export interface OrderedRegistry<T extends { id: string }> {
  register(entry: T, source: RegistrySource): Dispose;
  snapshot(): readonly T[];
  subscribe(listener: () => void): Dispose;
  records(): readonly RegistryRecord<T>[];
}

export type RegistrySource = ContributionOwner;

export interface RegistryRecord<T extends { id: string }>
  extends RegistrySource {
  value: T;
}

export function createOrderedRegistry<
  T extends { id: string },
>(): OrderedRegistry<T> {
  const listeners = new Set<() => void>();
  const ranks = new Map<string, number>();
  let nextRank = 0;
  let records: readonly RegistryRecord<T>[] = [];
  let snapshot: readonly T[] = [];

  const publish = (next: readonly RegistryRecord<T>[]): void => {
    records = next;
    snapshot = records.map((record) => record.value);
    for (const listener of listeners) listener();
  };

  return {
    register(entry, source) {
      if (records.some((candidate) => candidate.value.id === entry.id)) {
        throw new Error(`registry entry "${entry.id}" is already registered`);
      }
      if (!ranks.has(entry.id)) {
        ranks.set(entry.id, nextRank);
        nextRank += 1;
      }
      publish(
        [...records, { ...source, value: entry }].sort(
          (left, right) =>
            (ranks.get(left.value.id) ?? 0) - (ranks.get(right.value.id) ?? 0),
        ),
      );
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        publish(records.filter((candidate) => candidate.value !== entry));
      };
    },
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    records: () => records,
  };
}

export function createTabKindRegistry(): OrderedRegistry<UiTabKindContribution> {
  const registry = createOrderedRegistry<UiTabKindContribution>();
  return {
    ...registry,
    register(entry, source) {
      if (entry.kinds.length === 0) {
        throw new Error("tab-kinds: entry must declare at least one kind");
      }
      const claimed = new Set(
        registry.snapshot().flatMap((candidate) => candidate.kinds),
      );
      for (const kind of entry.kinds) {
        if (claimed.has(kind)) {
          throw new Error(`tab-kinds: kind "${kind}" is already registered`);
        }
        claimed.add(kind);
      }
      return registry.register(entry, source);
    },
  };
}

export interface ContributionSource {
  subscribe?(listener: () => void): Dispose;
  records(): readonly RegistryRecord<{ id: string }>[];
}

export interface UiShellContributionStore {
  entries<T extends { id: string }>(
    capability: UiContributionCapability,
  ): readonly RegistryRecord<T>[];
  snapshot(): number;
  subscribe(listener: () => void): Dispose;
  dispose(): void;
}

export function createUiShellContributionStore(
  sources: ReadonlyMap<UiContributionCapability, ContributionSource>,
): UiShellContributionStore {
  const listeners = new Set<() => void>();
  let revision = 0;
  const subscriptions = [...sources.values()].flatMap((source) =>
    source.subscribe
      ? [
          source.subscribe(() => {
            revision += 1;
            for (const listener of listeners) listener();
          }),
        ]
      : [],
  );

  return {
    entries: (capability) => {
      const source = sources.get(capability);
      if (!source) return [];
      return source.records() as readonly never[];
    },
    snapshot: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
      listeners.clear();
    },
  };
}

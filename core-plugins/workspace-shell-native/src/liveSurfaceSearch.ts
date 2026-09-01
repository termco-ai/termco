import type {
  Dispose,
  OptionalCapability,
} from "@termco/kernel";
import type { UiHeaderFindTarget } from "@termco/ui-header-base";
import type { UiSurfaceSearchCapability } from "@termco/ui-tabs-base";

type Registration = {
  tabId: number;
  target: UiHeaderFindTarget;
  unregister: () => void;
};

/** Keeps mounted surface registrations alive while the selected search
 * provider is replaced. Registry contents remain provider-owned; only active
 * consumer registrations are replayed into each provider generation. */
export function createLiveSurfaceSearchFacade(
  capability: OptionalCapability<UiSurfaceSearchCapability>,
  fallback: UiSurfaceSearchCapability,
): { value: UiSurfaceSearchCapability; dispose: Dispose } {
  const listeners = new Set<() => void>();
  const registrations = new Set<Registration>();
  const targetSnapshots = new Map<
    number,
    UiHeaderFindTarget | null
  >();
  let provider = capability.current() ?? fallback;
  let unsubscribeProvider = provider.subscribe(schedulePublish);
  let disposed = false;
  let publicationQueued = false;

  function sameTarget(
    previous: UiHeaderFindTarget | null,
    next: UiHeaderFindTarget | null,
  ): boolean {
    return previous === next || Boolean(
      previous &&
        next &&
        previous.kind === next.kind &&
        previous.findNext === next.findNext &&
        previous.findPrevious === next.findPrevious &&
        previous.clear === next.clear &&
        previous.focus === next.focus,
    );
  }

  function schedulePublish(): void {
    if (disposed || publicationQueued) return;
    publicationQueued = true;
    queueMicrotask(() => {
      publicationQueued = false;
      if (disposed) return;
      for (const [tabId, previous] of targetSnapshots) {
        const next = provider.target(tabId);
        if (!sameTarget(previous, next)) targetSnapshots.set(tabId, next);
      }
      for (const listener of [...listeners]) listener();
    });
  }

  function bindProvider(): void {
    for (const registration of registrations) registration.unregister();
    unsubscribeProvider();
    provider = capability.current() ?? fallback;
    unsubscribeProvider = provider.subscribe(schedulePublish);
    for (const registration of registrations) {
      registration.unregister = provider.register(
        registration.tabId,
        registration.target,
      );
    }
    schedulePublish();
  }

  const unsubscribeCapability = capability.subscribe(bindProvider);
  const value: UiSurfaceSearchCapability = {
    register(tabId, target) {
      if (disposed) return () => {};
      const registration: Registration = {
        tabId,
        target,
        unregister: () => {},
      };
      registrations.add(registration);
      registration.unregister = provider.register(tabId, target);
      return () => {
        if (!registrations.delete(registration)) return;
        registration.unregister();
      };
    },
    target(tabId) {
      if (!targetSnapshots.has(tabId)) {
        targetSnapshots.set(tabId, provider.target(tabId));
      }
      return targetSnapshots.get(tabId) ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    value,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await unsubscribeCapability();
      unsubscribeProvider();
      for (const registration of registrations) registration.unregister();
      registrations.clear();
      targetSnapshots.clear();
      listeners.clear();
    },
  };
}

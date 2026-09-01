import type { UiHeaderFindTarget } from "@termco/ui-header-base";
import type { UiSurfaceSearchCapability } from "@termco/ui-tabs-base";
import { describe, expect, it } from "vitest";
import { createLiveSurfaceSearchFacade } from "./liveSurfaceSearch";

function provider(): UiSurfaceSearchCapability {
  const targets = new Map<number, UiHeaderFindTarget>();
  const listeners = new Set<() => void>();
  return {
    register(tabId, target) {
      targets.set(tabId, target);
      for (const listener of listeners) listener();
      return () => {
        if (targets.get(tabId) !== target) return;
        targets.delete(tabId);
        for (const listener of listeners) listener();
      };
    },
    target: (tabId) => targets.get(tabId) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function observable(initial: UiSurfaceSearchCapability | undefined) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    capability: {
      current: () => current,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    select(next: UiSurfaceSearchCapability | undefined) {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

const fallback: UiSurfaceSearchCapability = {
  register: () => () => {},
  target: () => null,
  subscribe: () => () => {},
};

const target: UiHeaderFindTarget = {
  kind: "editor",
  findNext: () => {},
  findPrevious: () => {},
  clear: () => {},
  focus: () => {},
};

describe("live surface-search facade", () => {
  it("replays mounted registrations across provider generations until disposed", async () => {
    const first = provider();
    const selected = observable(first);
    const facade = createLiveSurfaceSearchFacade(selected.capability, fallback);
    const unregister = facade.value.register(7, target);

    expect(first.target(7)).toBe(target);

    const second = provider();
    selected.select(second);
    await Promise.resolve();

    expect(first.target(7)).toBeNull();
    expect(second.target(7)).toBe(target);
    expect(facade.value.target(7)).toBe(target);

    unregister();
    expect(second.target(7)).toBeNull();

    const third = provider();
    selected.select(third);
    await Promise.resolve();
    expect(third.target(7)).toBeNull();

    await facade.dispose();
  });

  it("stabilizes equivalent provider projections across publications", async () => {
    const source = provider();
    const projected: UiSurfaceSearchCapability = {
      ...source,
      target(tabId) {
        const current = source.target(tabId);
        return current ? { ...current, kind: "git-history" } : null;
      },
    };
    const selected = observable(projected);
    const facade = createLiveSurfaceSearchFacade(selected.capability, fallback);
    facade.value.register(7, target);

    const firstRead = facade.value.target(7);
    expect(facade.value.target(7)).toBe(firstRead);

    source.register(8, target);
    await Promise.resolve();
    expect(facade.value.target(7)).toBe(firstRead);

    source.register(7, { ...target, focus: () => {} });
    await Promise.resolve();
    expect(facade.value.target(7)).not.toBe(firstRead);

    await facade.dispose();
  });
});

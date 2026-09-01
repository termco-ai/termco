import { describe, expect, it, vi } from "vitest";
import { createOrderedRegistry } from "./registry";

const owner = (id: string) => ({
  pluginId: "test-registry",
  generation: "sha256-test-generation",
  key: id,
});

describe("ordered contribution registry", () => {
  it("keeps snapshot identity stable until the registry publishes", () => {
    const registry = createOrderedRegistry<{ id: string }>();
    const empty = registry.snapshot();

    expect(registry.snapshot()).toBe(empty);

    const dispose = registry.register({ id: "first" }, owner("first"));
    const registered = registry.snapshot();
    expect(registered).not.toBe(empty);
    expect(registry.snapshot()).toBe(registered);
    expect(registry.records()).toEqual([
      {
        pluginId: "test-registry",
        generation: "sha256-test-generation",
        key: "first",
        value: { id: "first" },
      },
    ]);

    dispose();
    const removed = registry.snapshot();
    expect(removed).not.toBe(registered);
    expect(registry.snapshot()).toBe(removed);

    dispose();
    expect(registry.snapshot()).toBe(removed);
  });

  it("preserves insertion order, rejects duplicate ids, and publishes cleanup", () => {
    const registry = createOrderedRegistry<{ id: string }>();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    const disposeFirst = registry.register({ id: "first" }, owner("first"));
    registry.register({ id: "second" }, owner("second"));

    expect(registry.snapshot().map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
    expect(() => registry.register({ id: "first" }, owner("first"))).toThrow(
      'registry entry "first" is already registered',
    );

    disposeFirst();
    expect(registry.snapshot().map((entry) => entry.id)).toEqual(["second"]);
    expect(listener).toHaveBeenCalledTimes(3);

    registry.register({ id: "first" }, owner("first"));
    expect(registry.snapshot().map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    registry.register({ id: "third" }, owner("third"));
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

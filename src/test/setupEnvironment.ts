/**
 * Node 26 exposes `globalThis.localStorage` as an experimental accessor, but
 * without `--localstorage-file` that accessor resolves to `undefined`. Vitest
 * copies the Node global into jsdom and masks jsdom's usable implementation.
 * Keep tests browser-shaped without a process-global persistence file, which
 * would leak state between parallel workers.
 */
class TestLocalStorage implements Storage {
  readonly #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
if (localStorageDescriptor?.get && localStorageDescriptor.enumerable === false) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: true,
    value: new TestLocalStorage(),
  });
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: () => {},
  });
}

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    writable: true,
    value: () =>
      Object.assign([], {
        item: () => null,
      }) as unknown as DOMRectList,
  });
}

if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => new DOMRect(),
  });
}

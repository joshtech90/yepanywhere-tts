import { beforeEach } from "vitest";
import { invalidateLocalStorageValues } from "./src/lib/localStorageValue";
import { invalidateSessionApps } from "./src/lib/sessionApps";

function createTestStorage(): Storage {
  const storage = new Map<string, string>();

  return {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };
}

// Do not probe window.localStorage first: Node 25's webstorage getter warns
// unless --localstorage-file has a valid path.
if (typeof window !== "undefined") {
  // jsdom has no media-query evaluator. Tests can override matches/events
  // when exercising responsive behavior or reduced-motion preferences.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (media: string) => {
      const events = new EventTarget();
      return {
        media,
        matches: false,
        onchange: null,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
        addListener: (listener: EventListener) =>
          events.addEventListener("change", listener),
        removeListener: (listener: EventListener) =>
          events.removeEventListener("change", listener),
      };
    },
  });
  const storage = createTestStorage();

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

beforeEach(() => {
  invalidateLocalStorageValues();
  invalidateSessionApps();
});

import { useMemo, useSyncExternalStore } from "react";
import { createLocalStorageValue } from "./localStorageValue";
import type { SessionVhostApp } from "./sessionVhostApps";

interface SessionApps {
  latest?: SessionVhostApp;
  dismissed: string[];
}
const stores = new Map<
  string,
  ReturnType<typeof createLocalStorageValue<string>>
>();
function parse(raw: string): SessionApps | undefined {
  try {
    const value = JSON.parse(raw);
    if (
      !Array.isArray(value.dismissed) ||
      !value.dismissed.every((id: unknown) => typeof id === "string")
    )
      return;
    if (
      value.latest &&
      ![value.latest.url, value.latest.sourceUrl, value.latest.label].every(
        (field) => typeof field === "string",
      )
    )
      return;
    return value;
  } catch {
    return;
  }
}

export function useSessionApps(key: string) {
  let store = stores.get(key);
  if (!store) {
    store = createLocalStorageValue<string>(
      `yep-anywhere-session-apps:${key}`,
      '{"dismissed":[]}',
      (raw) => (parse(raw) ? raw : undefined),
    );
    stores.set(key, store);
  }
  const raw = useSyncExternalStore(store.subscribe, store.read, store.read);
  const value = useMemo(() => parse(raw)!, [raw]);
  return { value, set: store.set };
}

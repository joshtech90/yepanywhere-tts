import { useSyncExternalStore } from "react";

type StoreListener = () => void;

export type ClientSummarySourceKey = string & {
  readonly __brand: "ClientSummarySourceKey";
};

export function asClientSummarySourceKey(
  value: string,
): ClientSummarySourceKey {
  return value as ClientSummarySourceKey;
}

export function createClientSummaryHostSourceKey(
  savedHostId: string,
): ClientSummarySourceKey {
  return asClientSummarySourceKey(`host:${savedHostId}`);
}

export function createClientSummaryDirectSourceKey(
  normalizedWsUrl: string,
): ClientSummarySourceKey {
  return asClientSummarySourceKey(`direct:${normalizedWsUrl}`);
}

export const LOCAL_CLIENT_SUMMARY_SOURCE_KEY =
  asClientSummarySourceKey("local");

export const REMOTE_NONE_CLIENT_SUMMARY_SOURCE_KEY =
  asClientSummarySourceKey("remote:none");

const currentSourceKeyListeners = new Set<StoreListener>();
let currentClientSummarySourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;

export function getCurrentClientSummarySourceKey(): ClientSummarySourceKey {
  return currentClientSummarySourceKey;
}

export function subscribeClientSummarySourceKey(
  listener: StoreListener,
): () => void {
  currentSourceKeyListeners.add(listener);
  return () => {
    currentSourceKeyListeners.delete(listener);
  };
}

export function useClientSummarySourceKey(): ClientSummarySourceKey {
  return useSyncExternalStore(
    subscribeClientSummarySourceKey,
    getCurrentClientSummarySourceKey,
    getCurrentClientSummarySourceKey,
  );
}

export function setCurrentClientSummarySourceKey(
  key: ClientSummarySourceKey,
): void {
  if (key === currentClientSummarySourceKey) {
    return;
  }

  currentClientSummarySourceKey = key;
  for (const listener of Array.from(currentSourceKeyListeners)) {
    listener();
  }
}

export function resetClientSummarySourceKeyForTests(): void {
  currentClientSummarySourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
  currentSourceKeyListeners.clear();
}

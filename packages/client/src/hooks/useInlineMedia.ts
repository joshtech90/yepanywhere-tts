import { useSyncExternalStore } from "react";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { createLocalStorageBoolean } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

const store = createLocalStorageBoolean(
  UI_KEYS.inlineMediaExpandedByDefault,
  false,
);
const galleryStore = createLocalStorageBoolean(
  UI_KEYS.compactMultiImageGalleries,
  true,
);

export const setInlineMediaExpandedPreference = store.set;
export const setCompactMultiImageGalleriesPreference = galleryStore.set;

export function useInlineMedia() {
  const storedExpandedByDefault = useSyncExternalStore(
    store.subscribe,
    store.read,
    store.read,
  );
  // A public share is read for what the session showed, images included; its
  // viewers have no settings page, so their media starts expanded.
  const inlineMediaExpandedByDefault =
    usePublicShareContext() !== null || storedExpandedByDefault;
  const compactMultiImageGalleries = useSyncExternalStore(
    galleryStore.subscribe,
    galleryStore.read,
    galleryStore.read,
  );
  return {
    compactMultiImageGalleries,
    inlineMediaExpandedByDefault,
    setCompactMultiImageGalleries: galleryStore.set,
    setInlineMediaExpandedByDefault: store.set,
  };
}

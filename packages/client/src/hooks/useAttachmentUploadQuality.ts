import type {
  ImagePreparationProfile,
  ProviderInfo,
} from "@yep-anywhere/shared";
import { useSyncExternalStore } from "react";
import { createLocalStorageValue } from "../lib/localStorageValue";
import { UI_KEYS } from "../lib/storageKeys";

export type AttachmentUploadQuality = "sd" | "hd";

const store = createLocalStorageValue<AttachmentUploadQuality>(
  UI_KEYS.attachmentUploadQuality,
  "sd",
  (raw) => (raw === "sd" || raw === "hd" ? raw : undefined),
);

export function useAttachmentUploadQuality(): [
  AttachmentUploadQuality,
  (quality: AttachmentUploadQuality) => void,
] {
  return [
    useSyncExternalStore(store.subscribe, store.read, store.read),
    store.set,
  ];
}

/** Select the session model's image preparation profile before uploading. */
export function getAttachmentUploadProfile(
  quality: AttachmentUploadQuality,
  provider?: ProviderInfo | null,
  modelId?: string | null,
): ImagePreparationProfile {
  const model = provider?.models?.find((candidate) =>
    modelId
      ? candidate.id === modelId || candidate.resolvedModel === modelId
      : candidate.isDefault === true,
  );
  const sizing = model?.imageSizing ?? provider?.imageSizing;
  if (sizing?.profiles) return sizing.profiles[quality];
  return {
    maxLongEdge:
      quality === "sd"
        ? Math.min(2000, sizing?.defaultLongEdgePx ?? 2000)
        : (sizing?.maxUsefulLongEdgePx ?? 2000),
    maxBytes: 3 * 1024 * 1024,
    quality: quality === "sd" ? 90 : 95,
  };
}

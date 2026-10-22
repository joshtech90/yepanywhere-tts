import {
  type AutoSessionTitleSettings,
  normalizeAutoSessionTitleSettings,
} from "@yep-anywhere/shared";
import { useCallback, useRef } from "react";

/**
 * Save one change of the automatic title settings. Each save sends the whole
 * object, so a change made before the server answered the previous one
 * builds on that unsaved value instead of the stored one. Otherwise leaving
 * the length field and tapping a checkbox right after reverts the length.
 */
export function useAutoSessionTitleUpdate(
  stored: AutoSessionTitleSettings | undefined,
  save: (next: AutoSessionTitleSettings) => Promise<void>,
): (patch: Partial<AutoSessionTitleSettings>) => Promise<void> {
  const unsavedRef = useRef<AutoSessionTitleSettings | null>(null);
  return useCallback(
    async (patch: Partial<AutoSessionTitleSettings>) => {
      const next = normalizeAutoSessionTitleSettings(
        patch,
        unsavedRef.current ?? normalizeAutoSessionTitleSettings(stored),
      );
      unsavedRef.current = next;
      try {
        await save(next);
      } finally {
        if (unsavedRef.current === next) unsavedRef.current = null;
      }
    },
    [save, stored],
  );
}

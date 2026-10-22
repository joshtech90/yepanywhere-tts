import { useEffect, useRef } from "react";

/**
 * One share handed over by the fork's Android app (packages/android-cockpit).
 * Its files are served by the app itself on this origin under `/__yep_app/`,
 * so they never leave the phone before the session starts.
 */
export interface CockpitAppShare {
  text?: string;
  files?: Array<{ url: string; name?: string; type?: string }>;
  /** Files the app could not take over (unreadable or too large). */
  missing?: number;
}

declare global {
  interface Window {
    __yepAppShare?: CockpitAppShare[];
  }
}

export const COCKPIT_APP_SHARE_EVENT = "yep-app-share";
const APP_FILE_PREFIX = "/__yep_app/";

async function loadSharedFile(file: {
  url: string;
  name?: string;
  type?: string;
}): Promise<File> {
  const response = await fetch(file.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`share file ${response.status}`);
  const blob = await response.blob();
  return new File([blob], file.name || "file", {
    type: file.type || blob.type,
  });
}

/**
 * Receives shares from the Android app in "New session". The app queues them
 * on `window.__yepAppShare` and dispatches `yep-app-share`; the queue covers a
 * share injected before this view mounted. Browsers never queue anything.
 */
export function useCockpitAppShare(
  onText: (text: string) => void,
  onFiles: (files: File[]) => void,
  onMissing: (count: number) => void,
): void {
  const latest = useRef({ onText, onFiles, onMissing });
  latest.current = { onText, onFiles, onMissing };

  useEffect(() => {
    let active = true;
    const drain = () => {
      const queue = window.__yepAppShare;
      if (!queue?.length) return;
      for (const share of queue.splice(0)) {
        const text = share.text?.trim();
        if (text) latest.current.onText(text);
        const offered = share.files ?? [];
        const files = offered.filter(
          (file) =>
            typeof file.url === "string" &&
            file.url.startsWith(APP_FILE_PREFIX),
        );
        // A text must never arrive silently without the files shared with it.
        const missingBefore =
          (Number.isInteger(share.missing) ? (share.missing ?? 0) : 0) +
          offered.length -
          files.length;
        if (files.length === 0) {
          if (missingBefore > 0) latest.current.onMissing(missingBefore);
          continue;
        }
        void Promise.allSettled(files.map(loadSharedFile)).then((results) => {
          if (!active) return;
          const loaded = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          );
          if (loaded.length > 0) latest.current.onFiles(loaded);
          const missing = missingBefore + files.length - loaded.length;
          if (missing > 0) latest.current.onMissing(missing);
        });
      }
    };
    drain();
    window.addEventListener(COCKPIT_APP_SHARE_EVENT, drain);
    return () => {
      active = false;
      window.removeEventListener(COCKPIT_APP_SHARE_EVENT, drain);
    };
  }, []);
}

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
// A share stays queued until an active form has accepted all of its parts.
const claimedShares = new WeakSet<CockpitAppShare>();

async function loadSharedFile(
  file: {
    url: string;
    name?: string;
    type?: string;
  },
  signal: AbortSignal,
): Promise<File> {
  const response = await fetch(file.url, { cache: "no-store", signal });
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
  enabled = true,
): void {
  const latest = useRef({ onText, onFiles, onMissing, enabled });
  latest.current = { onText, onFiles, onMissing, enabled };
  // Losses add up across shares; a later successful share (whose files may
  // clear the form's error) re-reports them instead of hiding them.
  const missingTotal = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let draining = false;
    let claimed: CockpitAppShare | undefined;
    const controller = new AbortController();
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        while (active && latest.current.enabled) {
          const share = window.__yepAppShare?.[0];
          if (!share || claimedShares.has(share)) return;
          claimed = share;
          claimedShares.add(share);
          const offered = share.files ?? [];
          const files = offered.filter(
            (file) =>
              typeof file.url === "string" &&
              file.url.startsWith(APP_FILE_PREFIX),
          );
          const results = files.length
            ? await Promise.allSettled(
                files.map((file) => loadSharedFile(file, controller.signal)),
              )
            : [];
          if (!active || !latest.current.enabled) return;
          const loaded = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          );
          const queue = window.__yepAppShare;
          const index = queue?.indexOf(share) ?? -1;
          if (index >= 0) queue?.splice(index, 1);
          claimedShares.delete(share);
          claimed = undefined;
          // Deliver text and attachments together, only once the form can
          // accept both. Navigation or starting a session leaves them queued.
          const text = share.text?.trim();
          if (text) latest.current.onText(text);
          if (loaded.length > 0) latest.current.onFiles(loaded);
          missingTotal.current +=
            (Number.isInteger(share.missing) ? (share.missing ?? 0) : 0) +
            offered.length -
            loaded.length;
          if (missingTotal.current > 0) {
            latest.current.onMissing(missingTotal.current);
          }
        }
      } finally {
        draining = false;
      }
    };
    const receive = () => {
      void drain();
    };
    receive();
    window.addEventListener(COCKPIT_APP_SHARE_EVENT, receive);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener(COCKPIT_APP_SHARE_EVENT, receive);
      if (claimed) {
        claimedShares.delete(claimed);
        window.dispatchEvent(new Event(COCKPIT_APP_SHARE_EVENT));
      }
    };
  }, [enabled]);
}

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useClientSummarySourceKey } from "../lib/clientSummaryStore";

export interface MessageNavigationOptions {
  target: string | null;
  enabled: boolean;
  onResolved?(target: string): Promise<void>;
  sessionId: string | undefined;
  messages: readonly { id?: string; uuid?: string }[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  olderCursor?: string;
  loadOlder(): Promise<void>;
  jump(messageId: string, onResolved: (found: boolean) => void): void;
  onError(kind: "unavailable" | "completion"): void;
}

export function useSessionMessageNavigation(options: MessageNavigationOptions) {
  const location = useLocation();
  const sourceKey = useClientSummarySourceKey();
  const target = options.target;
  const key = JSON.stringify([
    sourceKey,
    options.sessionId,
    location.key,
    target,
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const handled = useRef<string | undefined>(undefined);
  const attemptedPage = useRef<string | undefined>(undefined);
  const inFlightPage = useRef<string | undefined>(undefined);
  const [, setCompletedLoads] = useState(0);

  useEffect(() => {
    currentKey.current = key;
    return () => {
      currentKey.current = "";
    };
  }, [key]);

  useEffect(() => {
    if (
      !target ||
      !options.sessionId ||
      options.loading ||
      options.loadingOlder ||
      handled.current === key ||
      !options.enabled
    )
      return;
    if (
      !options.messages.some(
        (message) => (message.uuid ?? message.id) === target,
      )
    ) {
      const pageKey = JSON.stringify([key, options.olderCursor]);
      if (inFlightPage.current === key) return;
      if (
        options.hasOlder &&
        options.olderCursor &&
        attemptedPage.current !== pageKey
      ) {
        attemptedPage.current = pageKey;
        inFlightPage.current = key;
        void options
          .loadOlder()
          .catch(() => {
            if (currentKey.current === key) {
              handled.current = key;
              options.onError("unavailable");
            }
          })
          .finally(() => {
            if (inFlightPage.current === key) inFlightPage.current = undefined;
            if (currentKey.current === key)
              setCompletedLoads((count) => count + 1);
          });
        return;
      }
      handled.current = key;
      options.onError("unavailable");
      return;
    }
    handled.current = key;
    options.jump(target, (found) => {
      if (currentKey.current !== key) return;
      if (!found) {
        options.onError("unavailable");
        return;
      }
      void options.onResolved?.(target).catch(() => {
        if (currentKey.current === key) options.onError("completion");
      });
    });
  });
}

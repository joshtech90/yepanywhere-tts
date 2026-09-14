import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { isNonRetryableError } from "../lib/connection/types";
import {
  createManagedStream,
  isManagedStreamResubscribing,
  type ManagedStream,
  SERVER_PUSH_INACTIVITY_TIMEOUT_MS,
} from "../lib/transport";
import { useResubscribeOnFrontendSourceChange } from "./useResubscribeOnFrontendSourceChange";

export interface SessionWatchTarget {
  sessionId: string;
  projectId: string;
  provider?: string;
}

export interface SessionWatchChangeEvent {
  type: "session-watch-change";
  sessionId?: string;
  projectId?: string;
  provider?: string;
  path?: string;
  source?: "fs-watch" | "poll";
  changeVersion?: number;
  sourceObservedAt?: string;
  mtimeMs?: number;
  size?: number;
  timestamp?: string;
}

interface UseSessionWatchStreamOptions {
  onChange: (event: SessionWatchChangeEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onReconnect?: () => void;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeSessionWatchChangeEvent(
  data: unknown,
): SessionWatchChangeEvent {
  const value =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const source = value.source;
  return {
    type: "session-watch-change",
    sessionId: asOptionalString(value.sessionId),
    projectId: asOptionalString(value.projectId),
    provider: asOptionalString(value.provider),
    path: asOptionalString(value.path),
    source: source === "fs-watch" || source === "poll" ? source : undefined,
    changeVersion: asOptionalFiniteNumber(value.changeVersion),
    sourceObservedAt: asOptionalString(value.sourceObservedAt),
    mtimeMs: asOptionalFiniteNumber(value.mtimeMs),
    size: asOptionalFiniteNumber(value.size),
    timestamp: asOptionalString(value.timestamp),
  };
}

function getSessionWatchTargetKey(
  target: SessionWatchTarget | null,
): string | null {
  if (!target) {
    return null;
  }
  return `${target.projectId}\0${target.sessionId}\0${target.provider ?? ""}`;
}

/**
 * Focused session file-change subscription.
 *
 * Used by session detail pages for non-owned sessions so updates are driven by
 * a targeted server watch for the currently viewed session file.
 */
export function useSessionWatchStream(
  target: SessionWatchTarget | null,
  options: UseSessionWatchStreamOptions,
) {
  const [connected, setConnected] = useState(false);
  const [resubscribing, setResubscribing] = useState(false);
  const runtime = useCurrentSourceRuntime();
  const streamRef = useRef<ManagedStream | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetKey = getSessionWatchTargetKey(target);

  const reconnect = useCallback(() => {
    if (!targetKey) return;
    const stream = streamRef.current;
    if (!stream) {
      // The subscribe effect has not created a stream yet, so treat this as a
      // pending subscribe rather than a broken pipe.
      setConnected(false);
      setResubscribing(true);
      return;
    }
    // restart() publishes a new snapshot on every path that changes anything,
    // and declines only for an already terminal or closed stream whose
    // published state is the one we still want to show.
    stream.restart({ delayMs: 50 });
  }, [targetKey]);
  useResubscribeOnFrontendSourceChange(reconnect);

  useEffect(() => {
    const currentTarget = targetRef.current;
    if (!currentTarget || !targetKey) {
      setConnected(false);
      setResubscribing(false);
      return undefined;
    }

    let hasOpened = false;
    const stream = createManagedStream(
      runtime.transport,
      {
        subscribe: ({ transport, handlers }) =>
          transport.subscribeSessionWatch(currentTarget.sessionId, handlers, {
            projectId: currentTarget.projectId,
            provider: currentTarget.provider,
          }),
        onEvent: (event) => {
          if (event.eventType === "heartbeat") {
            return;
          }
          if (event.eventType === "session-watch-change") {
            optionsRef.current.onChange(
              normalizeSessionWatchChangeEvent(event.data),
            );
          }
        },
        onOpen: () => {
          setConnected(true);
          if (hasOpened) {
            optionsRef.current.onReconnect?.();
          } else {
            hasOpened = true;
            optionsRef.current.onOpen?.();
          }
        },
        onError: (error) => {
          setConnected(false);
          optionsRef.current.onError?.(new Event("error"));
          if (isNonRetryableError(error)) {
            console.warn(
              "[useSessionWatchStream] Non-retryable error, not reconnecting:",
              error.message,
            );
          }
        },
        onClose: () => {
          setConnected(false);
        },
      },
      {
        inactivityTimeoutMs: SERVER_PUSH_INACTIVITY_TIMEOUT_MS,
      },
    );
    streamRef.current = stream;
    // Every stream state change publishes a snapshot, so this subscription is
    // the single owner of both flags.
    const applySnapshot = () => {
      const snapshot = stream.getSnapshot();
      setConnected(snapshot.connected);
      setResubscribing(isManagedStreamResubscribing(snapshot));
    };
    const unsubscribe = stream.subscribe(applySnapshot);
    applySnapshot();

    return () => {
      unsubscribe();
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
      stream.close();
    };
  }, [runtime.transport, targetKey]);

  return { connected, reconnect, resubscribing };
}

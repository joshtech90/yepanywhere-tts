import { useCallback, useSyncExternalStore } from "react";

/**
 * Live output of running tool calls, keyed by tool_use id. A server that
 * can see a running command's output publishes `tool_output_preview`
 * messages; they never enter the transcript, and a row shows its preview
 * only while the call is pending. Each row subscribes to its own id, so an
 * update re-renders that row alone.
 */

/** Calls a session can plausibly have running at once, with slack. */
const MAX_PREVIEWS = 64;

const previews = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function notify(toolUseId: string): void {
  for (const listener of listeners.get(toolUseId) ?? []) listener();
}

export function setToolOutputPreview(toolUseId: string, text: string): void {
  previews.delete(toolUseId);
  previews.set(toolUseId, text);
  if (previews.size > MAX_PREVIEWS) {
    const oldest = previews.keys().next().value;
    if (oldest !== undefined) {
      previews.delete(oldest);
      notify(oldest);
    }
  }
  notify(toolUseId);
}

export function clearToolOutputPreview(toolUseId: string): void {
  if (previews.delete(toolUseId)) notify(toolUseId);
}

/** Drops the previews of calls whose results `message` carries. */
export function clearCompletedToolOutputPreviews(
  message: Record<string, unknown>,
): void {
  const inner = message.message;
  const content =
    inner && typeof inner === "object"
      ? (inner as { content?: unknown }).content
      : undefined;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      block.type === "tool_result" &&
      typeof block.tool_use_id === "string"
    ) {
      clearToolOutputPreview(block.tool_use_id);
    }
  }
}

export function useToolOutputPreview(
  toolUseId: string | undefined,
): string | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!toolUseId) return () => {};
      let set = listeners.get(toolUseId);
      if (!set) {
        set = new Set();
        listeners.set(toolUseId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(toolUseId);
      };
    },
    [toolUseId],
  );
  const read = () => (toolUseId ? previews.get(toolUseId) : undefined);
  return useSyncExternalStore(subscribe, read, read);
}

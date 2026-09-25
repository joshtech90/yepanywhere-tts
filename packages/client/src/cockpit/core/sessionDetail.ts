import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import type { ContentBlock } from "@yep-anywhere/shared/transcript/message";
import { parseUserPrompt } from "../../lib/parseUserPrompt";
import {
  createCockpitToolDisplay,
  type CockpitToolDisplay,
} from "./toolDisplay";

export interface CockpitTextSegment {
  id: string;
  text: string;
  augmentHtml?: string;
  isStreaming: boolean;
  abortedMidStream: boolean;
}

export interface CockpitThinkingSegment {
  id: string;
  text: string;
  status: "streaming" | "complete";
}

interface CockpitTranscriptEntryBase {
  key: string;
  timestamp?: string;
  /** Stable render-item references used only to retain unchanged row identity. */
  sourceItems?: readonly RenderItem[];
}

export interface CockpitUserAttachment {
  name: string;
  size: string;
}

export interface CockpitUserEntry extends CockpitTranscriptEntryBase {
  kind: "user";
  text: string;
  /** Files uploaded with the prompt, split off the provider-facing footer. */
  attachments?: CockpitUserAttachment[];
}

export interface CockpitAssistantEntry extends CockpitTranscriptEntryBase {
  kind: "assistant";
  text: CockpitTextSegment[];
  thinking: CockpitThinkingSegment[];
  spokenText: string;
  isStreaming: boolean;
}

export interface CockpitBoundaryEntry extends CockpitTranscriptEntryBase {
  kind: "boundary";
  subtype: "compact_boundary" | "status";
}

export interface CockpitToolEntry extends CockpitTranscriptEntryBase {
  kind: "tool";
  tool: CockpitToolDisplay;
}

export type CockpitTranscriptEntry =
  | CockpitUserEntry
  | CockpitAssistantEntry
  | CockpitBoundaryEntry
  | CockpitToolEntry;

export type CockpitSessionState =
  | "active"
  | "external"
  | "waiting"
  | "reconnecting"
  | "complete"
  | "offline"
  | "error";

export interface CockpitSessionStateInput {
  transport: "empty" | "loading" | "offline" | "error";
  loadError: boolean;
  owner: "none" | "self" | "external";
  processState: "idle" | "in-turn" | "waiting-input";
  updatesConnected: boolean;
  updatesResubscribing: boolean;
  /** Another program is driving the session (see core/activity.ts). */
  workingElsewhere?: boolean;
}

function timestampForItem(item: RenderItem): string | undefined {
  for (let index = item.sourceMessages.length - 1; index >= 0; index -= 1) {
    const timestamp = item.sourceMessages[index]?.timestamp;
    if (timestamp) return timestamp;
  }
  return undefined;
}

function contentText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content.trim();
  return content
    .flatMap((block) => {
      if (
        (block.type === "text" || block.type === "input_text") &&
        typeof block.text === "string"
      ) {
        return [block.text];
      }
      return [];
    })
    .join("\n\n")
    .trim();
}

function entryKey(
  sourceKey: string,
  sessionId: string,
  kind: CockpitTranscriptEntry["kind"],
  id: string,
): string {
  return `${sourceKey}\0session\0${sessionId}\0${kind}\0${id}`;
}

export function createCockpitTranscriptEntries(input: {
  previousEntries?: readonly CockpitTranscriptEntry[];
  sourceKey: string;
  sessionId: string;
  renderItems: readonly RenderItem[];
}): CockpitTranscriptEntry[] {
  const entries: CockpitTranscriptEntry[] = [];
  let assistantItems: Array<
    Extract<RenderItem, { type: "text" | "thinking" }>
  > = [];

  const flushAssistant = () => {
    if (assistantItems.length === 0) return;
    const first = assistantItems[0];
    if (!first) return;
    const text = assistantItems.flatMap<CockpitTextSegment>((item) =>
      item.type === "text" && item.text.trim()
        ? [
            {
              id: item.id,
              text: item.text,
              ...(item.augmentHtml ? { augmentHtml: item.augmentHtml } : {}),
              isStreaming: item.isStreaming === true,
              abortedMidStream: item.abortedMidStream === true,
            },
          ]
        : [],
    );
    const thinking = assistantItems.flatMap<CockpitThinkingSegment>((item) =>
      item.type === "thinking" && item.thinking.trim()
        ? [{ id: item.id, text: item.thinking, status: item.status }]
        : [],
    );
    if (text.length > 0 || thinking.length > 0) {
      const timestamp = timestampForItem(first);
      entries.push({
        kind: "assistant",
        key: entryKey(input.sourceKey, input.sessionId, "assistant", first.id),
        ...(timestamp ? { timestamp } : {}),
        sourceItems: assistantItems,
        text,
        thinking,
        spokenText: text.map((segment) => segment.text).join("\n\n").trim(),
        isStreaming:
          text.some((segment) => segment.isStreaming) ||
          thinking.some((segment) => segment.status === "streaming"),
      });
    }
    assistantItems = [];
  };

  for (const item of input.renderItems) {
    if (item.type === "user_prompt") {
      flushAssistant();
      const prompt = parseUserPrompt(contentText(item.content));
      if (prompt.text || prompt.uploadedFiles.length > 0) {
        const timestamp = timestampForItem(item);
        entries.push({
          kind: "user",
          key: entryKey(input.sourceKey, input.sessionId, "user", item.id),
          ...(timestamp ? { timestamp } : {}),
          sourceItems: [item],
          text: prompt.text,
          attachments: prompt.uploadedFiles.map((file) => ({
            name: file.originalName,
            size: file.size,
          })),
        });
      }
      continue;
    }

    if (item.type === "text" || item.type === "thinking") {
      assistantItems.push(item);
      continue;
    }

    if (item.type === "tool_call") {
      flushAssistant();
      const timestamp = timestampForItem(item);
      entries.push({
        kind: "tool",
        key: entryKey(input.sourceKey, input.sessionId, "tool", item.id),
        ...(timestamp ? { timestamp } : {}),
        sourceItems: [item],
        tool: createCockpitToolDisplay(item),
      });
      continue;
    }

    if (
      item.type === "system" &&
      (item.subtype === "compact_boundary" || item.subtype === "status")
    ) {
      flushAssistant();
      const timestamp = timestampForItem(item);
      entries.push({
        kind: "boundary",
        key: entryKey(input.sourceKey, input.sessionId, "boundary", item.id),
        ...(timestamp ? { timestamp } : {}),
        sourceItems: [item],
        subtype: item.subtype,
      });
    }
  }

  flushAssistant();
  if (!input.previousEntries?.length || entries.length === 0) return entries;

  const previousByKey = new Map(
    input.previousEntries.map((entry) => [entry.key, entry]),
  );
  return entries.map((entry) => {
    const previous = previousByKey.get(entry.key);
    if (
      !previous ||
      previous.kind !== entry.kind ||
      !previous.sourceItems ||
      !entry.sourceItems ||
      previous.sourceItems.length !== entry.sourceItems.length ||
      !previous.sourceItems.every(
        (sourceItem, index) => sourceItem === entry.sourceItems?.[index],
      )
    ) {
      return entry;
    }
    return previous;
  });
}

export function deriveCockpitSessionState({
  transport,
  loadError,
  owner,
  processState,
  updatesConnected,
  updatesResubscribing,
  workingElsewhere = false,
}: CockpitSessionStateInput): CockpitSessionState {
  if (transport === "offline") return "offline";
  if (transport === "error" || loadError) return "error";
  if (transport === "loading" || updatesResubscribing) return "reconnecting";
  // Another program's work wins over a process state that only YA's own
  // process can own; a leftover value must not relabel it.
  if (workingElsewhere) return "external";
  if (processState === "waiting-input") return "waiting";
  if (processState === "in-turn") return "active";
  if (owner !== "none" && !updatesConnected) return "reconnecting";
  return "complete";
}

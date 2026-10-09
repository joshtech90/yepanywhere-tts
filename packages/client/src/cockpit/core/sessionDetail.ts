import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import type { ContentBlock } from "@yep-anywhere/shared/transcript/message";
import { formatFileSize } from "../../lib/formatFileSize";
import { parseUserPrompt } from "../../lib/parseUserPrompt";
import {
  buildComposerTailDisplayRows,
  type ComposerTailDisplayRow,
  type RenderDeferredMessage,
  type RenderPendingMessage,
} from "../../lib/sessionDetail/composerTail";
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
  /**
   * Begins a provider turn that no user prompt started, such as the agent
   * waking up for a finished background task.
   */
  turnStart?: true;
  /** The provider aborted the turn right after this entry. */
  turnAborted?: true;
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

/**
 * A prompt the user already sent that the provider has not taken yet: either
 * still on its way to the server or waiting in the session's queue. It shows
 * faded at the end of the transcript until its own echo replaces it.
 */
export interface CockpitOutgoingEntry {
  key: string;
  /**
   * `queued` waits for the next turn; `patient` waits until the session is
   * quiet and lets regular queued prompts pass; `command` is a YA command
   * that runs after the current turn instead of going to the provider.
   */
  status: "sending" | "queued" | "patient" | "command" | "paused";
  /** 1-based place within its own queue lane (regular or patient). */
  position?: number;
  /** Progress of a running `/clearloop` command. */
  loop?: { completed: number; total: number };
  text: string;
  timestamp?: string;
  attachments: CockpitUserAttachment[];
  /** Files the queue summary only counts, without names or sizes. */
  attachmentCount?: number;
}

export interface CockpitOutgoingInput extends RenderDeferredMessage {
  content: string;
  clientOrder?: number;
  attachments?: readonly { originalName: string; size: number }[];
  clearloop?: { completed: number; total: number };
}

function outgoingStatus(
  row: Exclude<
    ComposerTailDisplayRow<RenderPendingMessage, CockpitOutgoingInput>,
    { kind: "project-queue" }
  >,
): Pick<CockpitOutgoingEntry, "status" | "position"> {
  if (row.kind === "pending") return { status: "sending" };
  if (row.isRecovered) return { status: "paused" };
  if (row.isYaCommand) return { status: "command" };
  if (row.isPatient) {
    return {
      status: "patient",
      position: (row.lanePosition?.patientIndex ?? 0) + 1,
    };
  }
  return {
    status: "queued",
    position: (row.lanePosition?.regularIndex ?? 0) + 1,
  };
}

/**
 * Projects useSession's pending echoes and server queue mirror with the same
 * order and lane rules as the classic composer tail; the Cockpit keeps no
 * queue copy of its own.
 */
export function createCockpitOutgoingEntries(input: {
  sourceKey: string;
  sessionId: string;
  pendingMessages: readonly (CockpitOutgoingInput & { tempId: string })[];
  deferredMessages: readonly CockpitOutgoingInput[];
}): CockpitOutgoingEntry[] {
  return buildComposerTailDisplayRows({
    pendingMessages: input.pendingMessages,
    deferredMessages: input.deferredMessages,
    // Message ages are not shown here, so the age inputs stay inert.
    latestVisibleTimestampMs: null,
    nowMs: 0,
    staleThresholdMs: Number.POSITIVE_INFINITY,
  }).flatMap<CockpitOutgoingEntry>((row) => {
    if (row.kind === "project-queue") return [];
    const message = row.message;
    const text = message.content.trim();
    const attachments = (message.attachments ?? []).map((file) => ({
      name: file.originalName,
      size: formatFileSize(file.size),
    }));
    const countedOnly =
      attachments.length === 0 && message.attachmentCount
        ? message.attachmentCount
        : 0;
    if (!text && attachments.length === 0 && countedOnly === 0) return [];
    return [
      {
        key: `${input.sourceKey}\0session\0${input.sessionId}\0outgoing\0${row.key}`,
        ...outgoingStatus(row),
        ...(message.clearloop ? { loop: message.clearloop } : {}),
        text,
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
        attachments,
        ...(countedOnly > 0 ? { attachmentCount: countedOnly } : {}),
      },
    ];
  });
}

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
  // Turn markers have no row of their own; they mark the neighbouring entry
  // so the Cockpit can tell where a provider turn began or was aborted.
  let turnStartPending = false;
  const push = (entry: CockpitTranscriptEntry) => {
    if (turnStartPending && entry.kind !== "user") entry.turnStart = true;
    turnStartPending = false;
    entries.push(entry);
  };
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
      push({
        kind: "assistant",
        key: entryKey(input.sourceKey, input.sessionId, "assistant", first.id),
        ...(timestamp ? { timestamp } : {}),
        sourceItems: assistantItems,
        text,
        thinking,
        spokenText: text
          .map((segment) => segment.text)
          .join("\n\n")
          .trim(),
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
        push({
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
      push({
        kind: "tool",
        key: entryKey(input.sourceKey, input.sessionId, "tool", item.id),
        ...(timestamp ? { timestamp } : {}),
        sourceItems: [item],
        tool: createCockpitToolDisplay(item),
      });
      continue;
    }

    if (item.type === "task_notification") {
      flushAssistant();
      turnStartPending = true;
      continue;
    }

    if (item.type === "system" && item.subtype === "turn_aborted") {
      flushAssistant();
      const last = entries[entries.length - 1];
      if (last && last.kind !== "user") {
        entries[entries.length - 1] = { ...last, turnAborted: true };
      }
      continue;
    }

    if (
      item.type === "system" &&
      (item.subtype === "compact_boundary" || item.subtype === "status")
    ) {
      flushAssistant();
      const timestamp = timestampForItem(item);
      push({
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
      previous.turnStart !== entry.turnStart ||
      previous.turnAborted !== entry.turnAborted ||
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

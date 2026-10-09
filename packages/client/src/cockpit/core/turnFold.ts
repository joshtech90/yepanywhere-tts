import { canonicalizeToolName } from "../../lib/toolNames";
import type {
  CockpitAssistantEntry,
  CockpitTranscriptEntry,
} from "./sessionDetail";

/**
 * One row standing in for the work of a finished turn: the tool calls,
 * thinking and interim messages before its final answer.
 */
export interface CockpitFoldEntry {
  kind: "fold";
  key: string;
  expanded: boolean;
  /** Tool calls the fold hides. */
  steps: number;
  /** Assistant messages with text before the final answer. */
  notes: number;
}

export type CockpitDisplayEntry = CockpitTranscriptEntry | CockpitFoldEntry;

export interface CockpitTurnFoldOptions {
  /** Fold keys the reader opened in this view. */
  expandedFoldKeys: ReadonlySet<string>;
  /** Leave the latest turn as it is, because it is still running. */
  latestTurnOpen: boolean;
}

/**
 * A question the agent put to the user and a plan the user approved are the
 * user's own decisions, so they stay in the conversation.
 */
const CONVERSATION_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

function staysVisible(entry: CockpitTranscriptEntry): boolean {
  if (entry.kind === "boundary") return true;
  if (entry.kind !== "tool") return false;
  const item = entry.sourceItems?.[0];
  return (
    item?.type === "tool_call" &&
    CONVERSATION_TOOLS.has(canonicalizeToolName(item.toolName))
  );
}

function isFinalAnswer(
  entry: CockpitTranscriptEntry | undefined,
): entry is CockpitAssistantEntry {
  return (
    entry?.kind === "assistant" &&
    !entry.isStreaming &&
    entry.text.length > 0 &&
    !entry.text.some((segment) => segment.abortedMidStream)
  );
}

// The final answer shows without its thinking. Caching the copy keeps its
// identity while the source entry is unchanged, so its row is not re-rendered.
const answersWithoutThinking = new WeakMap<
  CockpitAssistantEntry,
  CockpitAssistantEntry
>();

function withoutThinking(entry: CockpitAssistantEntry): CockpitAssistantEntry {
  if (entry.thinking.length === 0) return entry;
  let answer = answersWithoutThinking.get(entry);
  if (!answer) {
    answer = { ...entry, thinking: [] };
    answersWithoutThinking.set(entry, answer);
  }
  return answer;
}

function foldTurn(
  prompt: CockpitTranscriptEntry | null,
  body: readonly CockpitTranscriptEntry[],
  expandedFoldKeys: ReadonlySet<string>,
): CockpitDisplayEntry[] {
  const head = prompt ? [prompt] : [];
  const answer = body[body.length - 1];
  // A turn that ended on a tool call, was interrupted or is still writing has
  // no final answer to stand for it; the reader needs to see what happened.
  if (!isFinalAnswer(answer)) return [...head, ...body];

  let steps = 0;
  let notes = 0;
  for (const entry of body.slice(0, -1)) {
    if (staysVisible(entry)) continue;
    if (entry.kind === "tool") steps += 1;
    else if (entry.kind === "assistant" && entry.text.length > 0) notes += 1;
  }
  const hidesSomething =
    answer.thinking.length > 0 ||
    body.slice(0, -1).some((entry) => !staysVisible(entry));
  if (!hidesSomething) return [...head, ...body];

  const key = `${(prompt ?? body[0] ?? answer).key}\0fold`;
  const expanded = expandedFoldKeys.has(key);
  const fold: CockpitFoldEntry = { kind: "fold", key, expanded, steps, notes };
  if (expanded) return [...head, fold, ...body];
  return [
    ...head,
    fold,
    ...body.slice(0, -1).filter(staysVisible),
    withoutThinking(answer),
  ];
}

/**
 * Reduces finished turns to the user's prompt and the agent's final answer.
 * Everything in between collapses into one fold row the reader can open; the
 * running turn stays complete. Pure projection: the canonical entries are not
 * changed, and an opened fold shows them in their original order.
 */
export function foldCockpitTurns(
  entries: readonly CockpitTranscriptEntry[],
  { expandedFoldKeys, latestTurnOpen }: CockpitTurnFoldOptions,
): CockpitDisplayEntry[] {
  const turns: Array<{
    prompt: CockpitTranscriptEntry | null;
    body: CockpitTranscriptEntry[];
  }> = [];
  let current: (typeof turns)[number] = { prompt: null, body: [] };
  for (const entry of entries) {
    if (entry.kind === "user") {
      if (current.prompt || current.body.length > 0) turns.push(current);
      current = { prompt: entry, body: [] };
      continue;
    }
    current.body.push(entry);
  }
  if (current.prompt || current.body.length > 0) turns.push(current);

  return turns.flatMap((turn, index) => {
    if (latestTurnOpen && index === turns.length - 1) {
      return turn.prompt ? [turn.prompt, ...turn.body] : turn.body;
    }
    return foldTurn(turn.prompt, turn.body, expandedFoldKeys);
  });
}

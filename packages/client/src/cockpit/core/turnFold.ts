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
    !entry.turnAborted &&
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

/**
 * Named after the answer's last text segment: an older page can bring the
 * turn's prompt or merge earlier items into the answer's group, but not
 * change its last segment, so an opened fold stays open while history loads.
 */
export function foldKey(last: CockpitTranscriptEntry): string {
  if (last.kind !== "assistant") return `${last.key}\0fold`;
  const lastSegment = last.text[last.text.length - 1];
  return `${lastSegment?.id ?? last.key}\0fold`;
}

// Unchanged fold rows keep their identity, keyed by the turn's last entry, so
// a live update does not re-render every historical fold.
const foldsByLastEntry = new WeakMap<
  CockpitTranscriptEntry,
  CockpitFoldEntry
>();

function foldRow(
  last: CockpitTranscriptEntry,
  expanded: boolean,
  steps: number,
  notes: number,
): CockpitFoldEntry {
  const previous = foldsByLastEntry.get(last);
  if (
    previous &&
    previous.expanded === expanded &&
    previous.steps === steps &&
    previous.notes === notes
  ) {
    return previous;
  }
  const fold: CockpitFoldEntry = {
    kind: "fold",
    key: foldKey(last),
    expanded,
    steps,
    notes,
  };
  foldsByLastEntry.set(last, fold);
  return fold;
}

function countHidden(entries: readonly CockpitTranscriptEntry[]) {
  let steps = 0;
  let notes = 0;
  for (const entry of entries) {
    if (staysVisible(entry)) continue;
    if (entry.kind === "tool") steps += 1;
    else if (entry.kind === "assistant" && entry.text.length > 0) notes += 1;
  }
  return { steps, notes };
}

/** A step that failed, was stopped or never finished. */
function isFailedStep(entry: CockpitTranscriptEntry): boolean {
  return entry.kind === "tool" && entry.tool.status !== "complete";
}

/**
 * The user wrote again while the agent was still working, so the turn has no
 * answer of its own; its steps fold without one. Failed, stopped and
 * unfinished steps stay in view, because they may be why the user wrote.
 */
function foldInterjectedTurn(
  head: CockpitTranscriptEntry[],
  body: readonly CockpitTranscriptEntry[],
  expandedFoldKeys: ReadonlySet<string>,
): CockpitDisplayEntry[] {
  const last = body[body.length - 1];
  const keep = (entry: CockpitTranscriptEntry) =>
    staysVisible(entry) || isFailedStep(entry);
  if (
    last?.kind !== "tool" ||
    body.some((entry) => entry.turnAborted) ||
    body.every(keep)
  ) {
    return [...head, ...body];
  }
  const { steps, notes } = countHidden(body.filter((entry) => !keep(entry)));
  const fold = foldRow(last, expandedFoldKeys.has(foldKey(last)), steps, notes);
  if (fold.expanded) return [...head, fold, ...body];
  return [...head, fold, ...body.filter(keep)];
}

function foldTurn(
  prompt: CockpitTranscriptEntry | null,
  body: readonly CockpitTranscriptEntry[],
  expandedFoldKeys: ReadonlySet<string>,
  interjected: boolean,
): CockpitDisplayEntry[] {
  const head = prompt ? [prompt] : [];
  const answer = body[body.length - 1];
  if (!isFinalAnswer(answer) || body.some((entry) => entry.turnAborted)) {
    if (interjected) return foldInterjectedTurn(head, body, expandedFoldKeys);
    // Otherwise a turn that ended on a tool call, was aborted or interrupted,
    // or is still writing has no final answer to stand for it; the reader
    // needs to see what happened.
    return [...head, ...body];
  }

  const { steps, notes } = countHidden(body.slice(0, -1));
  const hidesSomething =
    answer.thinking.length > 0 ||
    body.slice(0, -1).some((entry) => !staysVisible(entry));
  if (!hidesSomething) return [...head, ...body];

  const fold = foldRow(
    answer,
    expandedFoldKeys.has(foldKey(answer)),
    steps,
    notes,
  );
  if (fold.expanded) return [...head, fold, ...body];
  return [
    ...head,
    fold,
    ...body.slice(0, -1).filter(staysVisible),
    withoutThinking(answer),
  ];
}

/**
 * Reduces finished turns to the user's prompt and the agent's final answer.
 * A turn the agent began on its own, after a background task finished, folds
 * separately, so the answer before it stays visible.
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
    if (entry.kind === "user" || entry.turnStart) {
      if (current.prompt || current.body.length > 0) turns.push(current);
      current =
        entry.kind === "user"
          ? { prompt: entry, body: [] }
          : { prompt: null, body: [entry] };
      continue;
    }
    current.body.push(entry);
  }
  if (current.prompt || current.body.length > 0) turns.push(current);

  // While the agent works, everything since the latest prompt stays open,
  // including turns a background task started in the middle of it.
  let firstOpenTurn = turns.length;
  if (latestTurnOpen) {
    firstOpenTurn = Math.max(0, turns.length - 1);
    while (firstOpenTurn > 0 && !turns[firstOpenTurn]?.prompt) {
      firstOpenTurn -= 1;
    }
  }
  return turns.flatMap((turn, index) => {
    if (index >= firstOpenTurn) {
      return turn.prompt ? [turn.prompt, ...turn.body] : turn.body;
    }
    return foldTurn(
      turn.prompt,
      turn.body,
      expandedFoldKeys,
      Boolean(turns[index + 1]?.prompt),
    );
  });
}

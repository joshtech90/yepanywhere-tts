import type { RenderItem } from "@yep-anywhere/shared/transcript/items";

/**
 * A tool call without a result that is older than this no longer counts as
 * work in another program. Foreground Bash and Codex commands time out well
 * before it; a transcript frozen for longer most likely belongs to a process
 * that was killed mid-call (topics/session-ownership.md, blue banner).
 */
export const COCKPIT_FOREIGN_TOOL_MAX_AGE_MS = 30 * 60 * 1000;

export interface CockpitLatestTurn {
  /** Start of the tip-most tool call of the latest turn that has no result. */
  openToolCallAt: number | null;
  /** The latest turn ended in a finished answer, an abort, or an error. */
  settled: boolean;
}

function itemTimestamp(item: RenderItem): number | null {
  for (let index = item.sourceMessages.length - 1; index >= 0; index -= 1) {
    const value = item.sourceMessages[index]?.timestamp;
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function isSettlingItem(item: RenderItem): boolean {
  if (item.type === "text") return item.isStreaming !== true;
  if (item.type === "system") {
    return item.subtype === "turn_aborted" || item.subtype === "error";
  }
  return false;
}

/**
 * Reads only the latest turn of the already projected transcript. A tool call
 * counts as open whether the projection calls it pending or incomplete: the
 * server marks every unanswered tool_use as orphaned when it reads a file it
 * does not own, even while another program is still running that tool.
 */
export function inspectCockpitLatestTurn(
  items: readonly RenderItem[],
): CockpitLatestTurn {
  let start = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const type = items[index]?.type;
    if (type === "user_prompt" || type === "session_setup") {
      start = index + 1;
      break;
    }
  }

  let settled = false;
  for (let index = items.length - 1; index >= start; index -= 1) {
    const item = items[index];
    if (!item) continue;
    if (item.type === "system" && item.subtype === "config_ack") continue;
    settled = isSettlingItem(item);
    break;
  }

  let openToolCallAt: number | null = null;
  for (let index = items.length - 1; index >= start; index -= 1) {
    const item = items[index];
    if (
      item?.type === "tool_call" &&
      !item.isSubagent &&
      !item.toolResult &&
      (item.status === "pending" || item.status === "incomplete")
    ) {
      openToolCallAt = itemTimestamp(item);
      break;
    }
  }

  return { openToolCallAt, settled };
}

export interface CockpitForeignActivityInput {
  owner: "none" | "self" | "external";
  processState: "idle" | "in-turn" | "waiting-input";
  latestTurn: CockpitLatestTurn;
  now: number;
}

/**
 * True when another program (a terminal Claude Code, a second YA server) is
 * working in this session. YA sees that program only through the transcript
 * file: "external" ownership lasts ~30 s after its last write, so a long quiet
 * command falls back to "none". An unanswered, recent tool call at the end of
 * an unsettled turn keeps the session visibly busy through that silence.
 */
export function isCockpitSessionWorkingElsewhere({
  owner,
  processState,
  latestTurn,
  now,
}: CockpitForeignActivityInput): boolean {
  if (owner === "external") return true;
  if (owner !== "none" || processState !== "idle") return false;
  if (latestTurn.settled || latestTurn.openToolCallAt === null) return false;
  const age = now - latestTurn.openToolCallAt;
  return age >= -60_000 && age < COCKPIT_FOREIGN_TOOL_MAX_AGE_MS;
}

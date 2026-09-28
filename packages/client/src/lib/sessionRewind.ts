import {
  SESSION_REWIND_CAPABILITY,
  type ServerCapabilitySource,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { getMessageId } from "@yep-anywhere/shared/transcript/message";
import { isRealUserTurn } from "@yep-anywhere/shared/transcript/messageProjection";
import type { DraftControls } from "../hooks/useDraftPersistence";
import type { Message } from "../types";
import {
  type ComposerTransferDraftControls,
  insertComposerTransferText,
} from "./sessionComposerSubmission";

/** Providers whose sessions YA can rewind in place. See topics/session-rewind.md. */
const REWIND_PROVIDERS = new Set(["claude", "claude-gateway", "claude-ollama"]);

export function providerSupportsSessionRewind(
  provider: string | null | undefined,
): boolean {
  return Boolean(provider && REWIND_PROVIDERS.has(provider));
}

/**
 * Same-session rewind is optional: an older server has no rewind route, so
 * the client must show no Clear entries and send no request.
 */
export function supportsSessionRewind(
  version: ServerCapabilitySource | null | undefined,
  provider: string | null | undefined,
): boolean {
  return (
    providerSupportsSessionRewind(provider) &&
    serverHasCapability(version, SESSION_REWIND_CAPABILITY)
  );
}

export interface SessionTurnIndex {
  /** Render id by turn index N over the full sequence, cleared turns too. */
  idByIndex: Map<number, string>;
  indexById: Map<string, number>;
  /** Turns currently inside a cleared span (not valid `/clear` targets). */
  clearedIds: Set<string>;
  /** Highest index known to this client, cleared turns included. */
  lastIndex: number;
  /**
   * Highest index still in the live conversation — the turn a command that
   * omits `N` means by "here". A rewound session's dropped turns keep higher
   * ordinals than the cut, so `lastIndex` names a turn no longer in the
   * conversation; 0 when nothing live remains.
   */
  lastLiveIndex: number;
}

function stampedTurnIndex(message: Message): number | undefined {
  const value = (message as { turnIndex?: unknown }).turnIndex;
  return typeof value === "number" ? value : undefined;
}

/**
 * The stable turn index N for every user turn (topics/session-rewind.md
 * § Vocabulary). Server normalization stamps `turnIndex` over the full
 * sequence, cleared turns included, and its stamp is authoritative. A
 * persisted row it left unstamped is not a turn. Only rows the server has
 * not normalized yet (live stream rows) are numbered here, with the same
 * `isRealUserTurn` predicate, continuing from the last stamped turn; a
 * server too old to stamp gets that numbering for every row.
 */
export function getSessionTurnIndex(
  messages: readonly Message[],
): SessionTurnIndex {
  const idByIndex = new Map<number, string>();
  const indexById = new Map<string, number>();
  const clearedIds = new Set<string>();
  let lastIndex = 0;
  let lastLiveIndex = 0;
  const serverStamps = messages.some(
    (message) => stampedTurnIndex(message) !== undefined,
  );
  for (const message of messages) {
    const stamped = stampedTurnIndex(message);
    if (
      stamped === undefined &&
      (!isRealUserTurn(message) ||
        (serverStamps && message._source === "jsonl"))
    ) {
      continue;
    }
    const id = getMessageId(message);
    if (!id || indexById.has(id)) continue;
    const index = stamped ?? lastIndex + 1;
    lastIndex = Math.max(lastIndex, index);
    idByIndex.set(index, id);
    indexById.set(id, index);
    if (typeof message.rewoundGroupId === "string") clearedIds.add(id);
    else lastLiveIndex = Math.max(lastLiveIndex, index);
  }
  return { idByIndex, indexById, clearedIds, lastIndex, lastLiveIndex };
}

/**
 * Clear replacing this turn (topics/session-rewind.md § Turn menu): rewind to
 * before the turn, then hand its prompt back to the composer. The draft is
 * written only after the rewind succeeds, and never overwrites typed text —
 * a nonempty draft keeps it and gains the prompt after it. Controls are read
 * when the rewind settles, since the composer may have remounted meanwhile.
 */
export async function rewindThenDraftPrompt(
  rewind: () => Promise<boolean>,
  promptText: string,
  getControls: () =>
    | (ComposerTransferDraftControls & Pick<DraftControls, "flushDraft">)
    | null
    | undefined,
): Promise<boolean> {
  if (!(await rewind())) return false;
  const controls = getControls();
  if (promptText.trim() && controls) {
    insertComposerTransferText(controls, promptText);
    // Persist at once so a page reload keeps the handed-back prompt.
    controls.flushDraft();
  }
  return true;
}

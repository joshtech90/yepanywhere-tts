import type {
  ClaudeSessionEntry,
  SessionRewindRecord,
} from "@yep-anywhere/shared";
import {
  REWOUND_GROUP_SUBTYPE,
  getLogicalParentUuid,
  isCompactBoundary,
} from "@yep-anywhere/shared";
import {
  buildDag,
  collectAllToolResultIds,
  findOrphanedToolUses,
  findSiblingToolBranches,
  findSiblingToolResults,
} from "./dag.js";

export interface VisibleClaudeEntriesResult {
  entries: ClaudeSessionEntry[];
  orphanedToolUses: Set<string>;
}

interface NormalizeClaudeEntriesOptions {
  includeOrphans?: boolean;
  /**
   * Same-session rewinds recorded by YA. Rows a rewind dropped are removed
   * from active-branch selection and re-emitted after the cut as a group
   * headed by a synthetic `rewound_group` system row. See
   * topics/session-rewind.md.
   */
  rewindRecords?: readonly SessionRewindRecord[];
}

interface RewoundGroupHeader {
  raw: ClaudeSessionEntry;
  lineIndex: number;
}

/**
 * Rows a rewind record dropped. The session is the full sequence of rows in
 * file order (topics/session-rewind.md): a rewind at a cut groups every row
 * after the cut's line that was written before the rewind and not already
 * claimed by an earlier rewind. Membership is positional, not by parent
 * chain, so a compaction inside the cleared span cannot split it.
 */
function collectRewoundRows(
  rawMessages: ClaudeSessionEntry[],
  records: readonly SessionRewindRecord[],
): {
  rewoundGroupByUuid: Map<string, string>;
  rewoundGroupByLine: Map<number, string>;
  headers: Map<string, RewoundGroupHeader>;
} {
  const rewoundGroupByUuid = new Map<string, string>();
  const rewoundGroupByLine = new Map<number, string>();
  const headers = new Map<string, RewoundGroupHeader>();
  if (records.length === 0)
    return { rewoundGroupByUuid, rewoundGroupByLine, headers };

  // Rows without a uuid — a queued message's enqueue/delivery pair is the one
  // that reaches the view — are members too: a queued message delivered into a
  // cleared span was cleared with it (topics/session-rewind.md § /clearloop).
  const rows: Array<{
    uuid: string | undefined;
    lineIndex: number;
    timestamp: string | undefined;
    /** Rows the view renders, so the header's dropped-row count matches. */
    countable: boolean;
  }> = [];
  const lineByUuid = new Map<string, number>();
  const timestampByUuid = new Map<string, string>();
  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (!raw || raw.type === "progress") continue;
    const uuid = getEntryUuid(raw);
    const timestamp =
      "timestamp" in raw && typeof raw.timestamp === "string"
        ? raw.timestamp
        : undefined;
    rows.push({
      uuid,
      lineIndex,
      timestamp,
      countable: uuid !== undefined || hasQueueOperationContent(raw),
    });
    if (uuid) {
      lineByUuid.set(uuid, lineIndex);
      if (timestamp) timestampByUuid.set(uuid, timestamp);
    }
  }

  const sorted = [...records].sort((left, right) =>
    left.at.localeCompare(right.at),
  );
  for (const record of sorted) {
    const cutLine = lineByUuid.get(record.cutMessageId);
    if (cutLine === undefined) continue;
    let firstLineIndex = Number.POSITIVE_INFINITY;
    let count = 0;
    for (const row of rows) {
      if (row.lineIndex <= cutLine) continue;
      if (rewoundGroupByLine.has(row.lineIndex)) continue;
      if (row.timestamp !== undefined && row.timestamp > record.at) continue;
      rewoundGroupByLine.set(row.lineIndex, record.id);
      if (row.uuid) rewoundGroupByUuid.set(row.uuid, record.id);
      if (!row.countable) continue;
      firstLineIndex = Math.min(firstLineIndex, row.lineIndex);
      count += 1;
    }
    if (count === 0) continue;
    const header = {
      type: "system",
      subtype: REWOUND_GROUP_SUBTYPE,
      uuid: `rewound-group-${record.id}`,
      parentUuid: record.cutMessageId,
      // The header sits at the cut in time as well as in order: timeline
      // entries sort by their latest row time, and the rewind time would
      // drag the cut's turn past later rows. The rewind time is in
      // `rewoundGroup.at`.
      timestamp: timestampByUuid.get(record.cutMessageId) ?? record.at,
      content: "",
      isSynthetic: true,
      rewoundGroupId: record.id,
      rewoundGroup: {
        reason: record.reason,
        cutTurnIndex: record.cutTurnIndex,
        droppedTurnCount: record.droppedTurnCount,
        rowCount: count,
        at: record.at,
        ...(record.clearloopIteration !== undefined
          ? { clearloopIteration: record.clearloopIteration }
          : {}),
        ...(record.clearloopTotal !== undefined
          ? { clearloopTotal: record.clearloopTotal }
          : {}),
        ...(record.clearloopPrompt
          ? { clearloopPrompt: record.clearloopPrompt }
          : {}),
      },
    } as unknown as ClaudeSessionEntry;
    headers.set(record.id, { raw: header, lineIndex: firstLineIndex - 0.5 });
  }
  return { rewoundGroupByUuid, rewoundGroupByLine, headers };
}

function hasQueueOperationContent(raw: ClaudeSessionEntry): boolean {
  if (raw.type !== "queue-operation" || raw.operation !== "enqueue") {
    return false;
  }

  if (typeof raw.content === "string") {
    return raw.content.trim().length > 0;
  }

  return Array.isArray(raw.content) && raw.content.length > 0;
}

/**
 * A queue-operation entry with the YA-computed delivery stamp that
 * normalization spreads onto the served Message (Message.queueDeliveredAt).
 */
type StampedClaudeSessionEntry = ClaudeSessionEntry & {
  queueDeliveredAt?: string;
};

function collectHistoricalQueueEntries(
  rawMessages: ClaudeSessionEntry[],
): Array<{ lineIndex: number; raw: StampedClaudeSessionEntry }> {
  const pendingEnqueues: Array<{ lineIndex: number; raw: ClaudeSessionEntry }> =
    [];
  const historicalEntries: Array<{
    lineIndex: number;
    raw: StampedClaudeSessionEntry;
  }> = [];

  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (raw?.type !== "queue-operation") continue;

    if (raw.operation === "enqueue") {
      if (hasQueueOperationContent(raw)) {
        pendingEnqueues.push({ lineIndex, raw });
      }
      continue;
    }

    if (
      (raw.operation === "dequeue" || raw.operation === "remove") &&
      pendingEnqueues.length > 0
    ) {
      const nextEntry = pendingEnqueues.shift();
      if (raw.operation === "remove" && nextEntry) {
        // Stamp when the queued message was delivered into the turn (the
        // remove op's timestamp). The entry only becomes visible at delivery
        // while keeping its enqueue-position lineIndex, so incremental
        // afterMessageId slicing needs this to know the entry is newer than
        // a mid-turn anchor (see pagination.ts).
        const deliveredAt =
          typeof raw.timestamp === "string" ? raw.timestamp : undefined;
        historicalEntries.push(
          deliveredAt
            ? {
                lineIndex: nextEntry.lineIndex,
                raw: { ...nextEntry.raw, queueDeliveredAt: deliveredAt },
              }
            : nextEntry,
        );
      }
    }
  }

  return historicalEntries;
}

function insertEntryByLineIndex(
  entries: Array<{ lineIndex: number; raw: ClaudeSessionEntry }>,
  entry: { lineIndex: number; raw: ClaudeSessionEntry },
): void {
  const insertAt = entries.findIndex(
    (existing) => existing.lineIndex > entry.lineIndex,
  );
  if (insertAt === -1) {
    entries.push(entry);
    return;
  }
  entries.splice(insertAt, 0, entry);
}

function getEntryUuid(raw: ClaudeSessionEntry): string | undefined {
  const uuid = "uuid" in raw ? raw.uuid : undefined;
  return typeof uuid === "string" ? uuid : undefined;
}

function getEntryParentUuid(raw: ClaudeSessionEntry): string | undefined {
  const parentUuid = "parentUuid" in raw ? raw.parentUuid : undefined;
  return typeof parentUuid === "string" ? parentUuid : undefined;
}

function isCompactSummaryEntry(raw: ClaudeSessionEntry): boolean {
  return (
    raw.type === "user" &&
    (raw as { isCompactSummary?: unknown }).isCompactSummary === true
  );
}

export function collectVisibleClaudeEntries(
  allRawMessages: ClaudeSessionEntry[],
  options: NormalizeClaudeEntriesOptions = {},
): VisibleClaudeEntriesResult {
  const { includeOrphans = true } = options;
  const {
    rewoundGroupByUuid,
    rewoundGroupByLine,
    headers: rewoundHeaders,
  } = collectRewoundRows(allRawMessages, options.rewindRecords ?? []);
  // Rewound rows are withheld from tip selection so the cut is the live tail
  // until the session writes past it; they rejoin below as grouped extras.
  // Live rows keep their position in this filtered list, which is the line
  // space the live queue entries below are ordered in.
  const liveLineByRawLine = new Map<number, number>();
  let rawMessages: ClaudeSessionEntry[];
  if (rewoundGroupByUuid.size === 0) {
    rawMessages = allRawMessages;
  } else {
    rawMessages = [];
    for (let lineIndex = 0; lineIndex < allRawMessages.length; lineIndex++) {
      const raw = allRawMessages[lineIndex];
      if (!raw) continue;
      const uuid = getEntryUuid(raw);
      if (uuid && rewoundGroupByUuid.has(uuid)) continue;
      liveLineByRawLine.set(lineIndex, rawMessages.length);
      rawMessages.push(raw);
    }
  }
  // Queued messages are paired across the whole file: a pair whose enqueue a
  // rewind claimed renders inside that group, the rest stay live.
  const historicalQueueEntries = collectHistoricalQueueEntries(allRawMessages);
  const { activeBranch } = buildDag(rawMessages);
  const activeBranchUuids = new Set(activeBranch.map((node) => node.uuid));
  const allToolResultIds = collectAllToolResultIds(rawMessages);
  const orphanedToolUses = includeOrphans
    ? findOrphanedToolUses(activeBranch, allToolResultIds)
    : new Set<string>();

  const lineIndexByUuid = new Map<string, number>();
  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    const uuid = raw ? getEntryUuid(raw) : undefined;
    if (uuid) {
      lineIndexByUuid.set(uuid, lineIndex);
    }
  }

  const extrasByParent = new Map<
    string,
    Array<{ lineIndex: number; raw: ClaudeSessionEntry }>
  >();

  const pushExtra = (
    parentUuid: string,
    raw: ClaudeSessionEntry,
    lineIndex: number,
  ) => {
    const existing = extrasByParent.get(parentUuid);
    const entry = { lineIndex, raw };
    if (existing) {
      existing.push(entry);
    } else {
      extrasByParent.set(parentUuid, [entry]);
    }
  };

  const compactSummariesByParent = new Map<
    string,
    Array<{ lineIndex: number; raw: ClaudeSessionEntry }>
  >();
  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (!raw || !isCompactSummaryEntry(raw)) continue;

    const parentUuid = getEntryParentUuid(raw);
    if (!parentUuid) continue;

    const existing = compactSummariesByParent.get(parentUuid);
    const entry = { lineIndex, raw };
    if (existing) {
      existing.push(entry);
    } else {
      compactSummariesByParent.set(parentUuid, [entry]);
    }
  }

  for (let lineIndex = 0; lineIndex < rawMessages.length; lineIndex++) {
    const raw = rawMessages[lineIndex];
    if (!raw || !isCompactBoundary(raw)) continue;

    const uuid = getEntryUuid(raw);
    if (!uuid) continue;

    const summaries = compactSummariesByParent.get(uuid) ?? [];
    if (activeBranchUuids.has(uuid)) {
      for (const summary of summaries) {
        const summaryUuid = getEntryUuid(summary.raw);
        if (!summaryUuid || !activeBranchUuids.has(summaryUuid)) {
          pushExtra(uuid, summary.raw, summary.lineIndex);
        }
      }
      continue;
    }

    const logicalParentUuid = getLogicalParentUuid(raw);
    if (!logicalParentUuid || !activeBranchUuids.has(logicalParentUuid)) {
      continue;
    }

    pushExtra(logicalParentUuid, raw, lineIndex);
    for (const summary of summaries) {
      const summaryUuid = getEntryUuid(summary.raw);
      if (!summaryUuid || !activeBranchUuids.has(summaryUuid)) {
        pushExtra(logicalParentUuid, summary.raw, summary.lineIndex);
      }
    }
  }

  for (const sibling of findSiblingToolResults(activeBranch, rawMessages)) {
    const uuid = getEntryUuid(sibling.raw);
    pushExtra(
      sibling.parentUuid,
      sibling.raw,
      uuid ? (lineIndexByUuid.get(uuid) ?? Number.MAX_SAFE_INTEGER) : 0,
    );
  }

  for (const branch of findSiblingToolBranches(activeBranch, rawMessages)) {
    for (const node of branch.nodes) {
      pushExtra(branch.branchPoint, node.raw, node.lineIndex);
    }
  }

  // Rewound rows rejoin as extras under their cut, headed by the group row,
  // so they render after the kept turn and before the live continuation. A
  // group whose cut is itself inside an earlier group nests: its header and
  // rows attach under the outermost live cut, in file order, and carry the
  // enclosing group as `rewoundParentGroupId` so the client can collapse
  // the whole span with the outer header.
  if (rewoundGroupByUuid.size > 0) {
    const cutByRecord = new Map<string, string>();
    for (const record of options.rewindRecords ?? []) {
      cutByRecord.set(record.id, record.cutMessageId);
    }
    const parentByRecord = new Map<string, string>();
    for (const [recordId, cut] of cutByRecord) {
      const parent = rewoundGroupByUuid.get(cut);
      if (parent && parent !== recordId) parentByRecord.set(recordId, parent);
    }
    const liveCutFor = (recordId: string): string | undefined => {
      let current: string | undefined = recordId;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        const cut = cutByRecord.get(current);
        if (cut && activeBranchUuids.has(cut)) return cut;
        current = parentByRecord.get(current);
      }
      return undefined;
    };
    const nested = (recordId: string, raw: ClaudeSessionEntry) => {
      const parent = parentByRecord.get(recordId);
      return (
        parent ? { ...raw, rewoundParentGroupId: parent } : raw
      ) as ClaudeSessionEntry;
    };
    for (const [recordId, header] of rewoundHeaders) {
      const cut = liveCutFor(recordId);
      if (cut) pushExtra(cut, nested(recordId, header.raw), header.lineIndex);
    }
    for (const entry of historicalQueueEntries) {
      const recordId = rewoundGroupByLine.get(entry.lineIndex);
      if (!recordId) continue;
      const cut = liveCutFor(recordId);
      if (!cut) continue;
      pushExtra(
        cut,
        nested(recordId, {
          ...entry.raw,
          rewoundGroupId: recordId,
        } as unknown as ClaudeSessionEntry),
        entry.lineIndex,
      );
    }
    for (let lineIndex = 0; lineIndex < allRawMessages.length; lineIndex++) {
      const raw = allRawMessages[lineIndex];
      const uuid = raw ? getEntryUuid(raw) : undefined;
      const recordId = uuid ? rewoundGroupByUuid.get(uuid) : undefined;
      if (!raw || !recordId) continue;
      const cut = liveCutFor(recordId);
      if (!cut) continue;
      pushExtra(
        cut,
        nested(recordId, {
          ...raw,
          rewoundGroupId: recordId,
        } as unknown as ClaudeSessionEntry),
        lineIndex,
      );
    }
  }

  for (const extras of extrasByParent.values()) {
    extras.sort((left, right) => left.lineIndex - right.lineIndex);
  }

  const entries: Array<{ lineIndex: number; raw: ClaudeSessionEntry }> = [];
  const includedUuids = new Set<string>();
  const includedNonUuidLineIndices = new Set<string>();
  const pushUnique = (raw: ClaudeSessionEntry, lineIndex: number) => {
    const uuid = getEntryUuid(raw);
    if (uuid) {
      if (includedUuids.has(uuid)) return;
      includedUuids.add(uuid);
    } else {
      // A grouped row's index is a file line; a live row's is its index in the
      // filtered list. The group qualifies the key so the two never collide.
      const group = (raw as { rewoundGroupId?: unknown }).rewoundGroupId;
      const key = `${typeof group === "string" ? group : ""}:${lineIndex}`;
      if (includedNonUuidLineIndices.has(key)) return;
      includedNonUuidLineIndices.add(key);
    }
    entries.push({ lineIndex, raw });
  };

  for (const node of activeBranch) {
    pushUnique(node.raw, node.lineIndex);

    const extras = extrasByParent.get(node.uuid);
    if (!extras) continue;

    for (const extra of extras) {
      pushUnique(extra.raw, extra.lineIndex);
    }
  }

  for (const queuedEntry of historicalQueueEntries) {
    if (rewoundGroupByLine.has(queuedEntry.lineIndex)) continue;
    const lineIndex =
      liveLineByRawLine.get(queuedEntry.lineIndex) ?? queuedEntry.lineIndex;
    const beforeLength = entries.length;
    pushUnique(queuedEntry.raw, lineIndex);
    if (entries.length === beforeLength) continue;

    const appended = entries.pop();
    if (!appended) continue;
    insertEntryByLineIndex(entries, appended);
  }

  return {
    entries: entries.map((entry) => entry.raw),
    orphanedToolUses,
  };
}

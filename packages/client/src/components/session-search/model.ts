import {
  getCollapsedSearchPreviewText,
  normalizeSearchPreviewText,
  type SessionContentMatch,
} from "@yep-anywhere/shared";
import type { GlobalSessionItem } from "../../api/client";
import { getSessionDisplayTitle } from "../../utils";

export type SearchField = "title" | "assistant" | "user";
export type TimeBasis = "turns" | "activity" | "created";
export const statuses = [
  "archived",
  "unarchived",
  "starred",
  "unstarred",
  "read",
  "unread",
] as const;
export type SearchStatus = (typeof statuses)[number];
export function matchesStatus(
  session: GlobalSessionItem,
  status: SearchStatus,
) {
  switch (status) {
    case "archived":
      return !!session.isArchived;
    case "unarchived":
      return !session.isArchived;
    case "starred":
      return !!session.isStarred;
    case "unstarred":
      return !session.isStarred;
    case "read":
      return !session.hasUnread;
    case "unread":
      return !!session.hasUnread;
  }
}
export function toggleStatus(
  previous: SearchStatus[],
  value: SearchStatus,
): SearchStatus[] {
  const group = Math.floor(statuses.indexOf(value) / 2);
  return previous.includes(value)
    ? previous.filter((s) => s !== value)
    : [
        ...previous.filter(
          (s) => Math.floor(statuses.indexOf(s) / 2) !== group,
        ),
        value,
      ];
}
export function durationMs(text: string, empty: number): number {
  if (!text.trim()) return empty;
  if (/^∞\s*d?$/i.test(text.trim()) && empty === Infinity) return Infinity;
  const match = /^(\d+(?:\.\d+)?)\s*([dhm]?)$/i.exec(text.trim());
  if (!match) return NaN;
  return (
    Number(match[1]) *
    ({ d: 86400000, h: 3600000, m: 60000 }[match[2]?.toLowerCase() || "d"] ??
      NaN)
  );
}
export function inTimeRange(
  timestamp: string | undefined,
  after?: number,
  before?: number,
) {
  if (after === undefined && before === undefined) return true;
  const value = Date.parse(timestamp ?? "");
  return (
    Number.isFinite(value) &&
    value >= (after ?? -Infinity) &&
    value <= (before ?? Infinity)
  );
}
export interface TitleMatch {
  id: string;
  role: "title";
  preview: string;
  fullText: string;
}
export type SearchMatch = SessionContentMatch | TitleMatch;
/** The preview budget applies independently to each selected turn type. */
export function limitTurnMatches(
  matches: SearchMatch[],
  limit: number,
): SessionContentMatch[] {
  const counts = { user: 0, assistant: 0 };
  return matches.filter(
    (match): match is SessionContentMatch =>
      match.role !== "title" && ++counts[match.role] <= limit,
  );
}
export function titleMatches(
  session: GlobalSessionItem,
  query: string,
  after?: number,
  before?: number,
): TitleMatch[] {
  if (!query.trim()) return [];
  const title = getSessionDisplayTitle(session) ?? "";
  const prompt =
    session.initialPrompt || session.fullTitle || session.title || "";
  const candidates = [
    title,
    ...(prompt !== title && inTimeRange(session.createdAt, after, before)
      ? [prompt]
      : []),
  ];
  const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
  const text = candidates.find((text) =>
    normalizeSearchPreviewText(text)
      .replace(/\s+/g, " ")
      .toLowerCase()
      .includes(needle),
  );
  return text
    ? [
        {
          id: "title",
          role: "title",
          fullText: text,
          preview: getCollapsedSearchPreviewText(text, query),
        },
      ]
    : [];
}

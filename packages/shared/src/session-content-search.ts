import { isClaudeProviderName, type ProviderName } from "./types.js";

/** Native-reader capability; the fallback covers servers predating its metadata field. */
export function providerSupportsBoundedTurnSearch(
  provider: ProviderName | undefined,
  advertised?: boolean,
): boolean {
  return (
    advertised ??
    (isClaudeProviderName(provider) ||
      provider === "codex" ||
      provider === "codex-oss")
  );
}

export interface SessionContentSearchRequest {
  sessionId: string;
  query: string;
  roles: Array<"user" | "assistant">;
  /** Inclusive absolute timestamp bounds for the content being searched. */
  after?: number;
  before?: number;
  cursor?: string;
  /** Accept an authoritative replacement batch when native history was rewritten. */
  allowRestart?: boolean;
  /** Return whole searchable text for bounded client-side refinement. */
  includeSearchText?: boolean;
}

export interface SessionContentMatch {
  id: string;
  role: "user" | "assistant";
  ordinal: number;
  timestamp?: string;
  /** Same excerpt budget as the in-session search rail. */
  preview: string;
  /** Whole search-eligible turn text, never an ellipsized display projection. */
  searchText?: string;
}

export interface SessionContentDiagnostic {
  id: string;
  message: string;
  /** Nearest preceding readable turn, when one exists. */
  messageId?: string;
  sourcePath?: string;
  byteOffset?: number;
}

export interface SessionContentSearchBatch {
  /** Every match carries whole searchText, including when this batch is empty. */
  includesSearchText?: boolean;
  matches: SessionContentMatch[];
  /** Native message IDs replaced by this batch, including messages that no longer match. */
  replacedIds?: string[];
  /** Clear prior matches and diagnostics before applying this batch. Opt-in on the request. */
  reset?: boolean;
  diagnostics?: SessionContentDiagnostic[];
  cursor?: string;
  done: boolean;
  /** Resume at the completed tail after a source update; optional on older servers. */
  resumeCursor?: string;
  partial: boolean;
  unavailable?: string;
  bytesRead: number;
}

export function normalizeSearchPreviewText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
}

export function getCollapsedSearchPreviewText(
  text: string,
  query: string,
  caseSensitive = false,
): string {
  const compactText = normalizeSearchPreviewText(text)
    .replace(/\s+/g, " ")
    .trim();
  const compactQuery = query.replace(/\s+/g, " ").trim();
  if (!compactText || !compactQuery) return compactText;
  const index = (
    caseSensitive ? compactText : compactText.toLowerCase()
  ).indexOf(caseSensitive ? compactQuery : compactQuery.toLowerCase());
  if (index === -1) return compactText;
  const start = Math.max(0, index - 24);
  const end = Math.min(compactText.length, index + compactQuery.length + 118);
  return `${start > 0 ? "..." : ""}${compactText.slice(start, end).trim()}${end < compactText.length ? "..." : ""}`;
}

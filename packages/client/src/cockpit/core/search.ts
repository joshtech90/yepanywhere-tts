import type { SessionContentMatch } from "@yep-anywhere/shared";
import type { GlobalSessionItem } from "../../api/client";
import {
  titleMatches,
  type SearchField,
  type SearchMatch,
} from "../../components/session-search/model";

export interface CockpitSearchResult {
  session: GlobalSessionItem;
  matches: SearchMatch[];
  titleMatched: boolean;
}

export interface CreateCockpitSearchResultsInput {
  sessions: readonly GlobalSessionItem[];
  query: string;
  fields: readonly SearchField[];
  contentMatches: ReadonlyMap<string, readonly SessionContentMatch[]>;
  discoveryOrder: Map<string, number>;
}

/**
 * Project the existing All Sessions title/content matches into stable Cockpit
 * session groups. The caller owns one discovery map per source and needle, so
 * later catalog pages and live matches append without moving rows already read.
 */
export function createCockpitSearchResults({
  sessions,
  query,
  fields,
  contentMatches,
  discoveryOrder,
}: CreateCockpitSearchResultsInput): CockpitSearchResult[] {
  if (!query.trim()) return [];

  const results = sessions.flatMap((session) => {
    const title = fields.includes("title")
      ? titleMatches(session, query)
      : [];
    const turns = contentMatches.get(session.id) ?? [];
    const matches: SearchMatch[] = [...title, ...turns];
    if (matches.length === 0) return [];
    if (!discoveryOrder.has(session.id)) {
      discoveryOrder.set(session.id, discoveryOrder.size);
    }
    return [
      {
        session,
        matches,
        titleMatched: title.length > 0,
      },
    ];
  });

  return results.sort(
    (left, right) =>
      discoveryOrder.get(left.session.id)! -
      discoveryOrder.get(right.session.id)!,
  );
}

import {
  issueLookupUrl,
  type IssueSearchResult,
  type IssueSessionsResult,
} from "@yep-anywhere/shared";

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

/**
 * Issue & PR association reads bound to one host's fetcher, so callers that
 * talk to several hosts (the Chrome extension) need no ambient current source.
 */
export function createIssuesApi(fetcher: Fetcher) {
  return {
    /**
     * The item a browser URL names. Sends `ref` for an exact identity match
     * and `q` for servers that predate it; either way only the item whose id
     * is that identity is kept, so `pull/12` never returns `pull/123`.
     */
    async lookup(
      url: string,
      options: { dismissed?: boolean } = {},
    ): Promise<IssueSearchResult | null> {
      const reference = issueLookupUrl(url);
      if (!reference) return null;
      const params = new URLSearchParams({
        q: reference.url,
        ref: url,
        limit: "10",
      });
      if (options.dismissed) params.set("dismissed", "1");
      const result = await fetcher<IssueSearchResult>(`/issues?${params}`);
      return {
        ...result,
        items: result.items.filter((item) => item.id === reference.identity),
      };
    },
    sessions(
      id: string,
      options: { dismissed?: boolean; limit?: number } = {},
    ): Promise<IssueSessionsResult> {
      const params = new URLSearchParams({
        id,
        limit: String(options.limit ?? 25),
      });
      if (options.dismissed) params.set("dismissed", "1");
      return fetcher<IssueSessionsResult>(`/issues/sessions?${params}`);
    },
  };
}

export type IssuesApi = ReturnType<typeof createIssuesApi>;

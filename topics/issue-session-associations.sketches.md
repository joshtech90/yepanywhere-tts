# Searchable tracker subjects and bodies

Candidate extension to [Issues & PRs](issue-session-associations.md).
Staged implementation is authorized. The current contract remains in the main
topic; the remainder below is candidate work. Subject and main body are the
first content scope; comments remain a later extension.

## Delivery stages

Landed: cached subject search; canonical subject/body storage and literal body
search; first-confirmation description retention; serial explicit historical
refresh with a configurable two-week default TTL and negative caching; icon
controls with right-click, long-press and keyboard force refresh; conditional revalidation and plain-text
cached details; independent subject/body and status/comment TTL sliders. The
main topic owns these contracts. Remaining stages below include automatic
per-mention TTL checks, automatic resumable backfill, shared scheduling of
confirmation/content work, and richer indexed
incremental-search presentation. Comments remain deferred.

1. Search and display subjects already fetched by the existing confirmation
   worker, preserving manual titles. This stage changes no acquisition policy,
   adds no network work, and needs no new schema or wire fields.
2. Add canonical-identity-owned subject/body storage and bounded acquisition,
   public access, negative caching, first-mention checks and historical backfill.
   Subject/body now share a configurable two-week default TTL and explicit-click
   revalidation. Comments will use the status/comment tier. Preserve the
   candidate acquisition policy below for later refinement.
3. Add body search and the full incremental-search interaction, reusing existing
   display primitives, with cached details and responsive input. Prove matching
   independently of UI polish if that gives earlier useful evidence.

Each stage should leave a useful tested result and move its actual contract
into the main topic. The order may change as implementation evidence warrants.

## Intent and acquisition

Make accessible GitHub issues/PRs and Jira tickets searchable by literal,
case-insensitive substrings of their subject and main body, alongside existing
keys and URLs. Public items should not require a credential; private items use
the configured tracker credential for their site. Preserve manual title
overrides while also searching the fetched subject.

A global tracker-content acquisition setting can default on within enabled
Issues & PRs. The parent feature remains default off. Every newly discovered
session mention performs a cheap local check against the canonical ticket's
acquisition record: have we scanned this item, and is its content still fresh?
This applies across sessions, not once per session. Missing or expired content
queues background acquisition; queued/in-flight work is shared. Respect the
existing discovery scope and conservative identity resolution: unknown bare
keys are not permission to guess a tracker host or send credentials there.

Existing stored mentions receive a one-time, resumable background backfill,
prioritizing missing subjects. Persist its cursor and acquisition receipts so
restarts do not repeat completed work. It stops when finished; it does not
become a recurring scan of all known tickets. Newly mentioned and explicitly
viewed tickets take priority over the historical backlog.

## Freshness and explicit clicks

The implemented sliders share one TTL for subject/body (two-week default) and
another for status/comments (five-minute default), each from one second through
Never expire (infinity). Future comment acquisition should use the latter.
TTL expiration only makes a part
eligible for refresh when a mention, view, or backfill checks it; expiration
does not start timers or polling.

An explicit ticket-details click always requests background revalidation,
independent of TTL, including Never expire. Show saved content immediately.
Coalesce repeated clicks with pending work and respect provider rate limits
and retry-after delays: always requesting refresh does not mean bypassing
throttling. Use provider-supported conditional requests, such as ETag or
Last-Modified validators, where available; verify each provider's support
during implementation. An unchanged response advances the validation time
without rewriting/reindexing content. Otherwise compare the fetched content
before updating its search representation. A view-triggered refresh must not
block opening or navigating the item.

## Durable content, not ephemeral display

The existing schema has observed/manual titles in `external_issues`, a fetched
title and check time in `issue_confirmations`, and separate tracker status
facts in `issue_tracker_status`. Canonical subject/body snapshots now live in
`issue_content`; the shared `IssueItem` deliberately carries no body. An
individual cached-content route loads it on selection. `IssueConfirmer` retains
description text from its authenticated first lookup; explicit content refresh
also permits public access. The legacy confirmation identity gap still applies
to old verdict/title fallback, not to canonical body storage.

Extend the canonical content record owned by `IssueStore` for future comment
acquisition; retain the implemented shared subject/body snapshot. Keep tracker
content separate from session mention evidence and user title overrides.
Resolve the existing
[confirmation identity gap](../gaps/issue-confirmation-cache-lacks-tracker-identity.md)
before widening acquisition to more sites. Future comment storage needs:

- Acquisition state: never requested, acquired (including a genuinely empty
  body), unavailable, or transient failure. Unavailable must not be mistaken
  for an empty body or proof that the issue does not exist.
- Last attempt time, last successful validation time, and retry eligibility.
  Retain the last good content across transient failures; do not mark it fresh.
- Saved text, content format, any provider revision/update timestamp, and
  supported HTTP validators. Fetch time is not the remote modification time.
- Coverage/truncation information if acquisition limits prevented a complete
  body. Missing content must not masquerade as a complete searchable snapshot.

Cache negative results too, so an inaccessible item does not generate a
request on every mention. Keep retry cooldowns distinct from successful-content
TTL. Credential/site-policy changes must invalidate incompatible pending work
and permit reconsidering previously unavailable items. Define access-loss and
cache-clear handling explicitly before implementation; never expose private
tracker content through public session shares.

Search uses durable local text, so a body can match before the user clicks its
ticket. List responses carry only bounded summaries/snippets and freshness;
load the cached full body through a detail read on selection. Render provider
content safely and normalize searchable text without requiring the browser to
download all bodies. Do not turn bodies into transient click-only data: that
would not satisfy search across previously acquired tickets.

## Performance boundaries

Network lookup is never on the typing, transcript rendering, or search request
critical path. Use bounded worker concurrency, bounded queue admission with a
durable continuation for overflow, request deadlines, per-host rate limits,
and bounded response/body sizes. Backfill shares these limits with ordinary
acquisition, and disabling acquisition stops new requests and fences stale
in-flight responses. Store content once per canonical ticket, not per mention.

Substring search over growing bodies needs an explicit cost check: a result
limit alone does not bound the amount of text SQLite examines. Measure a
representative large corpus and choose an index/query plan that preserves
literal substring semantics. Ordinary token full-text search is not an
equivalent replacement. Keep input acknowledgement independent of lookup and
result rendering; verify sequential typing under concurrent acquisition.

### Existing search and display reuse

Keep display reuse independent of index placement. The maintainer wants the
full incremental-search experience and accepts server-side matching.

- [All Sessions search](all-session-content-search.md) uses bounded per-session
  server reads with client fan-out, progressively delivered results and retained
  whole-text refinement, not a persistent corpus substring index.
  `packages/server/src/routes/session-content-search.ts` supplies optional
  `searchText` in response batches. Its client display owners under
  `packages/client/src/components/session-search/` include `SearchDetail`,
  `SearchPreviews` and `SearchSessionMatches`; shared highlighting lives in
  `packages/client/src/components/SearchPreview.tsx`. Reuse suitable highlighting,
  detail presentation, progressive result mounting, keyboard interaction and
  selection preservation. Extract only genuinely shared pieces; ticket results
  must not acquire artificial session/turn identities to fit these components.
- [Glossary tooltips](glossary-tooltips.md) do ship a server-compiled
  Aho-Corasick-style artifact. The owners are
  `packages/server/src/projects/glossaryIndexService.ts` and
  `packages/shared/src/glossary/{compiler,matcher}.ts`. This indexes a small,
  known phrase set to find those phrases in incoming text. Arbitrary user
  substrings over ticket bodies are a different indexing direction. Reuse its
  versioned artifact/cache ideas where useful, not its boundary semantics or
  algorithm by assumption.
- `packages/server/src/projects/projectPathIndex.ts` is a demand-driven,
  bounded directory-component cache used for server-side path annotation;
  it does not ship the filesystem matcher to the browser. Its generation,
  invalidation and memory-budget patterns are relevant references.
- `packages/client/src/lib/fileSearchIndex.ts` normalizes a fetched filename
  corpus once and refines cached prefix candidates. This is another small-corpus
  reference, distinct from the server's project-path index.

Compare bounded client snapshots/refinement with server-side indexed queries
for actual ticket volume and relay latency. Responsive incremental search is
the requirement; index placement is open. Superseded queries must not overwrite
newer results, and background content updates must preserve input and selection.

## Later: fresh comment search

Comments are useful search material, but excluded from the first slice.
Their eventual acquisition needs the status/comment TTL, stable comment identities,
pagination completion/cursors, edits and deletions, and bounded incremental
refresh where the provider supports it. A timestamp alone cannot claim that
all comments were acquired. Expose partial/stale coverage in search results.
If freshness beyond mention/view-triggered refresh is desired, decide that
separately rather than silently introducing permanent polling.

## Implementation review points

Review hosted-client compatibility before adding settings, detail routes or
response fields. Reuse the existing credential and acquisition owners rather
than adding a competing tracker client. Verify duplicate mentions, negative
cache hits, explicit-click revalidation, Never expire, conditional unchanged
responses, restart/backfill continuation, rate limiting, deletion fences and
setting changes. Body search must work without a prior details click.

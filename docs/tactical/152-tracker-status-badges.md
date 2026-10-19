# 152 — Tracker status on issue and PR rows

Status: implemented 2026-10-13, experimental, behind tracker confirmation.
The contract now lives in
[issue/session associations](../../topics/issue-session-associations.md#tracker-status).
Verified end to end against `TomFitAG/tomfit-android` #1272 (merged), #1273
(open), #1263 (draft) and #1250 (closed) from a standalone profile, with
header-menu captures at desktop and phone widths and an Issues page capture.

Kyle wants the session header's Issues & PRs menu to say whether a PR is
merged. The server already asks GitHub about each reference once when
[tracker confirmation](../../topics/issue-session-associations.md#tracker-confirmation)
is on, and that answer carries open/closed/merged state, but YA keeps only the
title and never asks again. Merge state changes, so it needs a refresh rule
that keeps the feature's "nothing polls" guarantee.

## Contract

- Opt-in: shown only while Issues & PRs and tracker confirmation are both on,
  using the same GitHub credential sources. No new setting.
- Scope: GitHub issues and PRs on `github.com`. Jira status and GitHub
  Enterprise are deferred.
- States: PR `open`, `draft`, `merged`, `closed`; issue `open`, `closed`.
  Each carries the time it was checked.
- Refresh when someone looks: a `GET /api/issues` read returns the status the
  server holds and starts a refresh for returned rows whose status is missing
  or older than five minutes. Merged is final and never asked again. A failed
  lookup is not retried for five minutes. With no reads there are no requests.
- Bounded: one in-flight refresh pass for the whole server; one GitHub GraphQL
  request per 50 references; at most 200 references waiting; at most 2,000
  remembered. Status lives in memory, so a restart forgets it and the next
  look asks again.
- Honest display: a row shows a state badge only when the server reported
  one, with the check time in its tooltip. Absent status shows nothing.

## Wire shape and compatibility

Additive, self-gated response fields; no capability bit and no new request:

- `IssueItem.trackerStatus?: { state, checkedAt }`;
- `IssueSearchResult.statusRefreshing?: true` while a refresh this read
  started or joined is still in flight.

Older servers omit both and clients show no badge; older clients ignore them.
The existing `issue-session-associations-v1` bit is not widened. Approved by
the maintainer in the originating request.

## Steps

### 1 — status refresher on the server

`services/issues/status.ts`: the in-memory cache, staleness rule, coalesced
GraphQL pass and its bounds. The list route annotates items and reports
`statusRefreshing`.

### 2 — status badges in the header menu and Issues page

A shared badge component. The header treats `statusRefreshing` like active
indexing within its existing bounded rechecks, and opening the menu re-reads
the list when its last answer is older than 30 seconds, so a long-open
session shows current state when someone looks.

### 3 — contracts and end-to-end check

Update the topic contract (replacing "colors never claim state") and the
server-capabilities record. Verify against real `TomFitAG/tomfit-android` PRs
(merged, open, draft) from a standalone profile with sample sessions.

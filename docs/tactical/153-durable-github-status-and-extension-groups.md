# 153 — Durable GitHub status and extension merged groups

Status: implemented and locally verified 2026-10-16. Commit requested; no publish.

Kyle wants the Chrome extension session panel to identify merged PRs and
collapse them, with clear controls over read-only GitHub requests and gh
credentials. Extend [152](152-tracker-status-badges.md) and the existing
[issue association contract](../../topics/issue-session-associations.md).
The earlier [credential inventory gap](../../gaps/issue-settings-fetches-credentials-before-opt-in.md)
is already gated in current source; preserve that no-probe-before-opt-in rule.

### 1 — GitHub controls

Separate status checks from reference confirmation. Preserve legacy saved
confirmation behavior when the new status option is absent. Allow gh by
default for enabled checks, with a disable switch and active/named CLI account.
A named account is authoritative, with no fallback to another credential.
Show the active credential source/account. Never switch global gh auth or
return tokens to clients. Existing tracker credentials retain their storage.

### 2 — Durable status

Append a discovery.sqlite migration. Store one row per canonical item with
state, checked time, merge date, GitHub node id and merge commit SHA. Merged
facts never expire; other states refresh only on viewed reads after five
minutes. Persist retry timestamps, retain prior answers on failure, batch
writes, and keep the existing shared queue and memory bounds. Disabled checks
still expose cached facts. Explicit cache clear removes status only.
No GitHub requests or provider reads occur during migration/startup.

### 3 — Extension merged section

Use existing state badges, display merge metadata, and group merged PRs under
an expandable heading. Add a browser-local collapse preference (default off).
Keep manual expansion stable across status refreshes. Unknown and closed
items remain visible. Use at most three short follow-up reads for a pending
status response, with teardown and no overlapping interval requests.

### 4 — Compatibility

Optional-feature corpus: local stable v0.9.1 (September 24) and v0.9.2
(September 26); no stable local tags in the preceding 14 days. Both have the
original issue routes but lack status controls and durable merge metadata.
Add one capability for new GitHub controls/cache actions; do not widen ID 68.
Missing capability hides new controls and sends no new fields/actions.
Optional response fields self-gate badges/details. Preserve omitted new
settings on older-client saves. No protocol or remote compatibility-level bump.
This plan and fallback were approved in the originating conversation.

### 5 — Verification and delivery

Exercise migration prefixes and rollback, restart persistence without a new
merged lookup, failed refreshes, disabled CLI probes, named-account failure,
settings preservation and capability fallback. Use an isolated YA data/profile,
provider histories, relay and Chromium profile for packaged extension
acceptance. Verify desktop/phone captures, group refresh and sequential typing
with concurrent updates (100 ms/key). Run required lint, format, typecheck,
unit tests, capability audit, CSS and console checks. Update owning topic and
roadmap status, record evidence here, and commit with the required identity
and Contributing-model trailer.

## Verification evidence — 2026-10-16

- Full `pnpm test` passed: client 6,979, server 6,576 (67 skipped), shared
  962, relay 136 and push broker 45, plus the repository Node test scripts.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, extension acceptance
  typechecking, console scan and CSS checks passed. Console budget unchanged.
- Capability audit: zero errors; two existing overdue provider/fork reviews
  remain recorded in [the gap](../../gaps/capability-transitional-reviews-overdue.md).
  Advancing their dates or removing gates requires a separate compatibility
  decision; neither was changed for this feature.
- Focused storage/credential/route tests passed 44 cases, covering every
  migration prefix through 10, rollback, durable state/retry delay, terminal
  merged facts, clear-vs-in-flight fencing, no CLI probes when disabled,
  authoritative account selection and old-client settings preservation.
- Packaged Chromium extension acceptance passed with its own temporary YA
  data directory, HOME, provider histories, relay and browser profile.
  Controlled GitHub responses cover 49 GitHub items plus an unknown reference
  on a separate local host. Real server replacement preserved merge date/SHA
  with no new lookup. UI tests exercised collapse, expansion retained through
  refresh, checks off, explicit cache clear and re-enable. Real sequential
  typing with concurrent transcript updates and panel refreshes peaked at
  6.7 ms/key, with all 35 characters retained (100 ms limit).
- A separate read-only live GitHub check of kzahel/yepanywhere PR 147 saved
  its actual merge date, node id and commit SHA, then reopened storage and
  served the same fact with zero requests. No tracker writes were made.
- Final desktop (1000x600) and phone (375x812) captures were presented through
  the repository artifact facility and inspected one at a time. Settings
  group status, CLI policy, account and cache controls without overflow;
  the cache action and merged heading have 44 px touch targets. PR metadata
  wraps correctly on phones. Captures are retained under
  `.artifacts/extension-acceptance/smoke/github-{settings,panel}-{1000,375}.png`.
- Shared settings CSS remains shared: touched-owner audit found no independent
  legacy slice to extract. New component styling stays in CSS Modules.
- Local validation ran on macOS. Linux/Windows CI was not run; no push or
  release was requested. Owned temporary servers and profiles were cleaned up.

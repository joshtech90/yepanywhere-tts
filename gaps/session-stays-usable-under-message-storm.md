# A message storm leaves the session view too busy to terminate

When a provider or a YA automation emits turns at a few per second, the session
view has no floor of usability. Each turn flips the session into the thinking
display and starts and clears the compacting spinner, so the header controls
never settle long enough to open the "..." menu and terminate the session. The
maintainer hit this on 2026-09-10: about three thousand `/compact` turns over
fourteen minutes, roughly three a second, each answered "Not enough messages to
compact." Recovery required restarting the provider runtime and the YA server.

The specific loop is fixed (commit "Stop the compact-early loop after a
completed compaction"; contract in
[resume-compaction](../topics/resume-compaction.md)), and a fresh page load of
the affected session renders and stays interactive at both desktop and phone
widths. What is missing is the general guarantee the maintainer asked for: a
session should stay calm enough to terminate even when the turn source is
misbehaving.

Three candidate shapes, not yet chosen:

- Fold consecutive identical local-command outputs into one row with a count,
  the way `transcriptProjection/compactBoundaries.ts` already coalesces
  boundaries and `shellFolding.ts` folds shell items.
- Rate-limit the transient operation indicators so a start/clear cycle faster
  than a person can read cannot drive the spinner or the thinking display.
- Adopt the server-authoritative `transientOperation` state already sketched
  under Future Direction in
  [compacting-indicator-reconciliation](../topics/compacting-indicator-reconciliation.md),
  which removes the client-side flag that flickers.

Worth measuring first: the affected session returns 10,765 messages and 13 MB
from `GET /api/projects/:projectId/sessions/:sessionId`, because compact-tail
pagination truncates at the last compact boundary and the whole storm landed
after it. Neither pagination mode caps a tail of that size.

Found 2026-09-10 while fixing the compact-early loop that produced the storm.

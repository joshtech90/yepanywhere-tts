# Secondary transcript readers and counts ignore same-session rewind records

The session detail route and the rewind routes project a Claude transcript
with the session's rewind records (`normalizeSession(loaded, { rewindRecords })`),
so dropped rows render as a collapsed group. Every other reader projects
without them and so treats a dropped tail as live until the session writes a
new turn past the cut:

- `packages/server/src/sessions/claude-summary.ts` — the catalog summary
  (`lastAgentText` for sidebar previews and hover cards, `messageCount`) scans
  raw lines from the tail; the dead branch wins between a rewind and the next
  turn. The summary index is keyed by file, and a rewind changes metadata, not
  the file, so passing records in would also need an invalidation hook.
- `packages/server/src/services/voice/vocabulary-sessions.ts`,
  `packages/server/src/app.ts` (`readPendingToolCall` for heartbeat liveness),
  `packages/server/src/maintenance/debug-routes.ts` — `normalizeSession(loaded)`
  with no records.
- The all-sessions search index reads through the same readers.
- Sidebar message counts and `totalUserTurns` in the pagination payload count
  positionally over the full sequence (the tail window itself now counts live
  turns only).

Impact is a stale preview or count in the interval between a rewind and the
next turn, which a `/clearloop` closes in seconds; a manual `/clear N` left
idle shows the dropped tail's last agent text until the user sends. Not fixed
with the activation-seam work because the summary index needs a metadata
invalidation path, and the remaining readers are diagnostic or advisory.

Cheap fix when the seam opens: a `normalizeSessionWithRewinds(deps, sessionId,
loaded)` helper used by every server-side normalize call, and a
`session-metadata-changed` listener that marks the summary index dirty when
`rewindRecord`/`rewindRecordRemoved` is set.

Related, also captured here rather than fixed: two tabs rewinding the same
session concurrently serialize only through the process abort, so the loser
gets a `409` ("cut is no longer in the session"); correct, unfriendly, and
rare enough to leave.

Found 2026-09-19 while closing the session-rewind provider-truth risks
(topics/session-rewind.md).

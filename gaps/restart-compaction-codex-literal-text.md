# Restart compaction bypasses Codex native command dispatch

At baseline `1aba656fb`, `tryRestartCompact` in
`packages/server/src/routes/sessions.ts:1241` discovers `compact`, then calls
`queueMessage({ text: "/compact" })` directly. `Process.queueMessage`
(`packages/server/src/supervisor/Process.ts:4019`) does not call the native
provider-command method. Codex implements native compaction separately, and
its adapter explicitly warns against sending `/compact` as plain text
(`packages/server/src/sdk/providers/codex.ts:2773`).

Static evidence therefore indicates restart/handoff sends a model prompt
instead of requesting native Codex compaction. It may wait for a boundary
that never arrives and then continue the handoff after its 12-second deadline.
No scripted-peer or live reproduction was performed in this plan review.
The existing route test name mentioning native compaction uses a mock queue;
it is not provider-protocol evidence.

Keep this separate from [plan 163](../docs/tactical/163-http-independent-restart-compaction.md)'s
move and resource cleanup. Diagnose with a scripted Codex peer, then select a
native-dispatch repair and its completion/failure policy explicitly. Do not
silently reconcile restart and resume semantics during extraction.

Found 2026-10-27 while rechecking the historical review against current source
for the bounded HTTP-separation plan.

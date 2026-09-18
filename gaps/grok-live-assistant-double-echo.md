# Grok live assistant turns still double-render

Grok sessions still show duplicate assistant (and often thinking) bubbles
while the turn is running. A reload collapses them to one copy. The joined
`</user_query>` user-turn remainder is a different defect: it is in
`updates.jsonl` and survives reload.

First attempt (`be05b95b4`) keyed live ACP and durable replay on
`_meta.eventId` and paired user turns by exact text. That cleared the
self-amplifying mid-turn fetch that happened when a Grok user echo could
never confirm. The remaining live doubles happen without busy-send
interjects (observed 2026-09-09; supervisor ~90% confident they are
independent).

Likely live-only merge: `GrokACPProvider.yieldUpdates` and
`GrokSessionReader` still disagree on some buffered run, or a mid-turn
jsonl backfill appends assistant rows whose ids do not match the live
stream. `needsApproxMessageDedup` stays false for Grok, so content+time
cannot collapse those copies.

Fix after the joined-user-turn split, in isolation, and check whether
doubles remain on a Grok session that does not interject.

Checked 2026-09-14: both live and durable readers still key buffered text and
thinking on the first chunk's `_meta.eventId`, with existing tests for each
path. The ACP client preserves notification metadata. A sample of the newest
20 project transcripts contained no empty text/thinking chunks, so the theory
that an empty first chunk shifts only one reader's identity was not supported.
Do not enable approximate content deduplication as a substitute for finding
that mismatch.

Checked 2026-09-15 on live session `01a0a6dc-dc37-7a02-a678-95de175a9763`
(screenshot of a confirmed user turn plus the first assistant sentence, each
shown twice). `updates.jsonl` has **one** `user_message_chunk` (event
`…-6147`) and **one** `agent_message_chunk` for that sentence (event
`…-6287`). Duplicates are live-only.

User-turn copy after confirm: Grok ACP re-yields the queued user message
with YA's uuid but without `tempId` / `messageMetadata`. `mergeStreamMessage`
replaced the optimistic echo and dropped the self-send marker, so
`reconcileSelfSendUserEchoes` could not pair it with Grok's `grok-evt-…`
jsonl row. Fix: Process no longer SSE-emits a same-uuid user re-yield, and
sdk-on-sdk merge keeps those markers when the incoming copy omits them.

Remaining: live assistant doubles that still collapse on reload. This
session's durable assistant row for that sentence is a single event-id
message; the second bubble is not in `updates.jsonl`.

Found 2026-09-09 while splitting concatenated Grok interject envelopes.

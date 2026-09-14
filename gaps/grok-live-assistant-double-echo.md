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

Found 2026-09-09 while splitting concatenated Grok interject envelopes.

# Some providers do not retain YA's user-turn identity

Pi emits YA's queued UUID in its live user echo (`sdk/providers/pi.ts`) but
its saved reader uses the native JSONL node ID (`sessions/pi-reader.ts`). The
prompt RPC does not pass YA's UUID into that saved node. These identities have
no durable mapping. Other adapters with provider-assigned user IDs need the
same audit before promising stable live-to-saved user-turn links.

This affects exact-turn links, including [cross-session delivery
attention](../topics/inbox.md#cross-session-delivery-attention): a receipt can
outlive its live echo yet fail to resolve after reload. The client keeps the
flag and reports that the turn is unavailable instead of acknowledging an
unrelated message. Claude UUIDs and Codex `clientUserMessageId` have explicit
identity paths; no content-based provenance inference was introduced.

Fix at the provider identity boundary: preserve the queued UUID in the native
record where supported, or retain a verified mapping from an authoritative
native user-message receipt. Matching arbitrary transcript text is not an
identity contract. This is left separate from adding the attention mechanism
because it requires provider-specific native protocol work.

Found 2026-09-14 while implementing cross-session delivery attention.

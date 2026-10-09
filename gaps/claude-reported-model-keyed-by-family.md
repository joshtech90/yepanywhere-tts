# A non-YA Claude session on a previous version is keyed as the current alias

`yaModelIdForReported()` in `packages/server/src/sdk/providers/claude.ts`
maps a reported model id to its family alias, so a session started outside YA
on `claude-opus-4-8` is keyed for per-model settings as `opus`, which now
means Opus 5.5. Previous versions are selectable opt-ins
([older-claude-models](../topics/older-claude-models.md)), so the mapping
could return the exact id when it names a concrete previous version the
catalog knows.

Not fixed in place because the keying contract
([provider-abstraction](../topics/provider-abstraction.md) § Per-model settings
keying) decides what a recovered id is for, and the per-model settings a
previous version should inherit is a product choice.

Found 2026-09-26 while refreshing Claude Code 2.1.283 / Agent SDK 0.3.283;
narrowed 2026-10-08 when the 2.1.293 refresh demoted the live catalog's
previous versions to opt-ins.

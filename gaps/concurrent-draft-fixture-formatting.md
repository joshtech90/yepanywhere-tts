# Concurrent draft fixture edit blocks repository formatting verification

`pnpm format:check` on 2026-09-29 reports one error in
`packages/client/e2e/fixtures.ts:321`: the new draft-cleanup fixture's long
`throw new Error(...)` needs Biome's multiline formatting.

The fixture was already modified by concurrent work before the New Session
visibility/sidebar fix began. Its added block is absent from HEAD, so the
formatting cannot be isolated as a cleanup of committed source without
including or editing another contributor's unfinished change. The New Session
commit leaves that file untouched; its own changed sources pass formatting.
The owner should format the fixture before committing it, then remove this gap.

Found 2026-09-29 while verifying the New Session app-link and sidebar fixes.

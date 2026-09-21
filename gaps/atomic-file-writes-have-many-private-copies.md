# Write-temp-then-rename is still hand-written across the server

`packages/server/src/utils/writeFileAtomically.ts` is the owner as of
2026-09-19, but only three callers use it (`artifacts/GrantStore.ts`,
`artifacts/VhostAccess.ts`, `sdk/providers/gatewayServiceExport.ts`). The rest
of the server still stages and renames inline:

```bash
rg -n 'const (staging|temporary|tempPath|temporaryPath|tmp[A-Za-z]*) *=' packages/server/src
```

That returns roughly two dozen sites (a few are unrelated — a staging
*directory*, a `.partial` upload). They were left alone deliberately: the
harsh-review item that created the helper scoped itself to the three new
copies and named the rest a follow-up sweep.

Two things make the sweep worth doing rather than filing forever:

- Several sites stage to a fixed `<file>.tmp` with no per-write suffix
  (`services/WorkstreamService.ts:851`,
  `services/SessionQueuePersistenceService.ts:371`,
  `services/DirtyFileEditorService.ts:523`,
  `services/SecurityClientService.ts:1513`,
  `services/ProjectQueueService.ts:1179`,
  `services/voice/VocabularyStore.ts:449`). Two writers over one file then
  share a staging name and the loser's rename fails with `ENOENT` — the exact
  failure the helper's unique name exists to prevent.
- Others carry semantics the helper does not: `projects/projectStoragePolicy.ts`
  fsyncs the file and the directory, `media/ToolResultMediaStore.ts` opens with
  `wx`, and the index writers derive their staging name from pid + time +
  `Math.random()`.

So the sweep is not mechanical: the helper needs a durability option (fsync,
and `syncDirectory` from the same directory) before the fsyncing callers can
move, and each caller's flag choices have to be read rather than assumed.

Found 2026-09-19 while landing harsh-review item 47 (a08cc4a9..69501d94),
which introduced the helper.

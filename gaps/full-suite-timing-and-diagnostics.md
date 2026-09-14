# Full server suite has timing failures and unasserted diagnostics

During issue #121 validation, `pnpm test` on macOS completed the server suite
with 4,689 passing, 53 skipped, and three failing tests:

- `test/supervisor.test.ts`: `probes provider status for long-silent active
  sessions` exceeded 5,000 ms; `emits a public remap when init follows the
  provisional ID timeout` failed at line 6656 with `Timers are not mocked`.
- `test/api/codex-compact.test.ts`: `rejects direct compaction during a turn
  without replacing the process` returned 200 instead of 409 at line 332.

An immediate focused rerun of both files passed all 13 Codex compaction tests,
while the supervisor file again timed out on the active-liveness probe and on
`requires verified idle liveness before queueing a synthetic turn`. It also
reported unmocked timers in the provider-retention test and an ownership
assertion failure in `keeps an idle owner registered until provider abort is
verified`. The shifting failures suggest timer interference but do not prove
its cause. The active probe fixture advances 330 seconds while its provider
iterator polls every 10 ms; investigate a deterministic deferred iterator and
ensure timed-out work cannot restore real timers during a later test.

The full run also emitted these unasserted warning diagnostics:

- `SESSION_DETAIL: slow request`, in the Grok redirect fixture used by
  `test/routes/sessions-metadata.test.ts`: 314.4 ms total, 309.8 ms augmentation.
  This is an observation under suite contention, not benchmark evidence.
- `Codex CLI update failed` in `test/services/CodexUpdateChecker.test.ts`, for
  permission denial, stale installed version, and failed production probe.
- `[WS Relay] Replay/old encrypted sequence rejected: seq=0, last=1` during
  encrypted transport coverage.
- `Resynchronized Codex turn id from provider notification` for the
  `compact-session` fixture (`message-1` to `compact-2`).
- `[Voice] ya-grok requested but YEP_STT_XAI_API_KEY is not set` and the
  corresponding `ya-deepgram` / `YEP_STT_DEEPGRAM_API_KEY` warning in
  `test/services/voice-registry.test.ts`.

These need focused fixture/diagnostic assertions rather than blanket log
suppression. They are deferred because fixing the timer lifecycle and auditing
provider/auth failure diagnostics crosses independent behavioral boundaries;
it cannot be safely bundled into a successful-file response serialization
repair. The issue #121 focused file/relay/public-share suite passes all 159
tests without warnings, and lint, formatting, and source type checks pass.

Found 2026-09-08 while validating issue #121 relay file downloads.

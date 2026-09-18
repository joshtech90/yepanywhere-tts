# Provider restart browser check intermittently misses its saved turn

`packages/client/e2e/slash-command-argument-completions.spec.ts`, the
"restarts the provider only after verified stop and reloads saved turns" case,
failed once in the full browser suite: its injected "Turn saved by the TUI"
was not visible within five seconds after restart. The isolated rerun passed
with the same capture mode. The full run otherwise passed 247 cases and skipped
seven.

The case mocks session-detail ownership/messages, session WebSocket events,
abort and reactivation while using the real transcript view. Investigate the
ordering between detail revalidation and subsequent live projection updates;
the missing turn alone does not establish which path dropped it. Capture
request/event ordering before changing waits or the production merge contract.

This was outside the All Sessions correction and did not reproduce in its
targeted rerun. Retain the failure rather than calling the full suite green or
loosening the assertion without a cause.

Found 2026-09-14 while verifying incremental All Sessions search.

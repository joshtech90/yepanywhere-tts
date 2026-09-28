# Workflow browser check intermittently records failed fetch warnings

The September 22 full browser run failed the desktop file-reference/inline/
nested-schema case in `packages/client/e2e/workflow-tags.spec.ts` because its
console collector recorded failed fetches from server settings, onboarding,
and auth initialization. Its workflow assertions completed. The same file
passed unchanged on a focused rerun, including both desktop and phone cases.

The test repeatedly navigates and reloads while exercising cache expiry. Page
unload cancelling unrelated initialization requests is a hypothesis; the log
alone does not establish it. Do not suppress these messages in the test or
relax the zero-warning expectation without tracing request lifetime and which
document owns the warning. An unload cancellation should be distinguished from
a failed request in a live document at the request owner.

Not pursued during the session-stall repair because the focused rerun passed
and the failure concerns a separate navigation/diagnostic lifecycle. Preserve
a trace on recurrence and correlate request failures with document navigation.

Found 2026-09-22 during publication checks for session-stall recovery.
Contributing-model: 6-Astra

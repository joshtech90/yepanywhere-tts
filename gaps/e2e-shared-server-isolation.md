# Full-app E2E cases share mutable server state

`packages/client/e2e/global-setup.ts` starts one YA server, relay, and data
directory for the whole Playwright invocation. Browser contexts are fresh per
test, but server settings, remote-access credentials, sessions, and files are
not reset between cases using that server. Before the focused repair,
`remote-login.spec.ts` and `relay-integration.spec.ts` both configured and
cleared the same remote-access state. The full local run with
`--workers=2` stopped after five failures and 186 passes, including two remote
login failures. The list reporter shows the remote-login and relay cases
interleaving during those failures; the exact cause of each failure is not yet
established.

The one-worker default serializes files, so it avoids simultaneous mutation
but can hide order dependencies and leaked state. The two-shard CI workflow
runs separate servers on separate runners, but still shares a server within
each shard. Audit mutating specs and their cleanup, reproduce suspected
interactions with focused pairs and changed order, then give each mutable
state boundary a reliable reset or an isolated server fixture. Verify cases
both alone and in the full suite before considering the gap closed. Keep
browser and transport coverage while making those checks independent.

A focused 2026-09-27 pair reproduced four failures in 26 cases with two
workers on the shared server. Giving `remote-login.spec.ts` a worker-scoped YA
process and data directory made the same pair pass 26/26 on a subsequent run.
Its own provider fixture needed a recent session and provider enrollment for
the sidebar checks. This isolates the credentials changed by remote login;
`relay-integration.spec.ts` and other mutating files still use the run-wide
server, and the pair needs more independent repetitions and full-suite evidence.
All 13 remote-login cases passed in the first full local one-worker run with
the isolated server; that run had two unrelated E2E failures elsewhere.

Found 2026-09-27 while comparing local two-worker execution with isolated CI
shards.

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

The 2026-09-29 draft-sync CI run exposed another shared-state path: a spec left
a synced composer draft for seeded `mock-session-001`, and later fresh browser
contexts loaded that draft from the shared server. The common browser fixture
now clears that seeded slot before each case using it. This is a focused repair;
other mutable server state still needs the audit above.

The 2026-09-29 worker fixture now owns seeded profiles, YA processes, relay
state and provider-host runtimes per Playwright worker; replacement workers
receive new profiles. Shared builds and remote-client servers remain
invocation-owned. Managed routes drain before page disposal, seeded draft
slots reset before use, and startup waits for real watcher baselines and a
settled catalog. A full local two-worker run with no retries passed 345 cases
and skipped 12 platform/device cases in 8.0 minutes, with successful process
and storage cleanup. At that checkpoint `YEP_E2E_SERVER_SCOPE=worker` remained
opt-in pending comparable Linux CI and repeated parallel schedules.
The explicit run-scoped control remains available. CI now runs two worker-owned
servers per shard, with comparable fixed-source measurements below. The first
worker CI pair was faster but had an async-question persistent failure and retry
passes; the next exposed lazy-route bootstrap ordering and cold reload fixture
assumptions. Those must pass on first attempts before closing this gap.

Found 2026-09-27 while comparing local two-worker execution with isolated CI
shards.

2026-09-30: [run 36653354418](https://github.com/kzahel/yepanywhere/actions/runs/36653354418)
passed every CI gate. The repaired startup/reload cases passed on their first
attempts; shard 1 passed 171 cases without retries, shard 2 passed 177 with one
relay typing retry. The merged local four-worker suite passed 347 cases and
skipped 12 without retries. Worker ownership is now the default, so ordinary
`--workers=N` invocations use isolated profiles and servers; explicit `run` scope
remains for the one-worker control. Worker count remains one by default. The
default-path regression fails against the former run scope because peer/retry
workers share every path. The fixed-source comparison passed both schedules
with one retry each and substantially shorter worker job times, as recorded in
the [ledger](../docs/testing/e2e-ci-cost-ledger.md). Full default-scope verification
and repeated first-attempt CI are the next checkpoint; the native typing bound
remains required.

The final default-scope local checkpoint passed all 347 cases with 12 skips,
four workers, no retries, and clean teardown in 4.2m. Root server/client suites
and strict E2E type checks also passed. This establishes the normal parallel
invocation's fixture ownership locally; repeated first-attempt Linux CI and
the comparable median/p90 window remain outstanding.

At published `cead003b4`, the exact-source manual CI repeat passed all gates
and both E2E shards without retries (349 passes, ten Linux skips). Its initial
push run failed restart verification after correctly restoring scrollTop 4937
with only 29ms left in the overall budget, and needed two cold-entry retries.
Startup ownership and the measured lifetime are the next repair; one green
repeat does not establish independent schedules or a steady failure rate.

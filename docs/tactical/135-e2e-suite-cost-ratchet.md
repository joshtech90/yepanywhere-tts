# Ratchet down client E2E suite cost

Status: reduction underway 2026-09-27. The test-level policy lives in
[E2E testing](../../topics/e2e-testing.md); this file tracks the reduction
sequence and measured evidence. The first reduction slice passed local
verification and one full CI job. The second slice also passed one full CI
job; a comparable CI window remains pending. Three two-shard E2E CI pairs
passed on isolated runners, while a local two-worker run stopped at its failure
limit.
Shared-server isolation is now the first reliability priority; further suite
speed work follows it.

The blanket local `pnpm test:e2e` rule first appeared in contributor guidance
on 2025-12-29, when the suite had about seven specs. Focused Playwright wording
was added in July 2026; this plan replaces the blanket local rule with a
boundary and cost decision while retaining the full CI gate.

## Goal and baseline

First make the full-app cases independent of shared mutable server state and
execution order. Then reduce browser-suite wall time and retry burden while
retaining the unique browser, server, transport, security, and real typing
regressions it catches. Keep the full suite in CI throughout the migration.

At the 2026-09-27 audit, the client suite had 109 spec files and 334 listed
cases. The [CI cost ledger](../testing/e2e-ci-cost-ledger.md) records the latest
35 completed `main` jobs: 30 passed, five failed, and successful job time had
a 20m39s median and 21m05s 90th percentile. Case counts grew from 318 to 334
across those commits. Four failed jobs share three `!! Commands` cases; one
older job failed a Files API case. Seven first-failing cases passed on retry.
These observations do not establish a stable flake rate or the cause of the
correlated failures.

One completed local run of 331 cases spent about 706 seconds in 323 executed
test bodies and 12.9 minutes overall. It had two stale New Session assertions
that were subsequently updated. CI per-spec medians below use the 30 passing
jobs; they supersede the local run for prioritizing cost.

| Spec | CI median / cases | Distinctive value and first question |
| --- | ---: | --- |
| `async-questions.spec.ts` | 72.0s / 1 | Keep live question arrival, focus, and scroll. Which draft, reply, and setting rules can move to focused component/hook tests? Isolate the known timing failure. |
| `relay-integration.spec.ts` | 56.9s / 13 | Encrypted relay is unique coverage. Which repeated UI assertions or setup work can be removed without losing the transport contract? Diagnose the correlated `!! Commands` failure. |
| `slash-command-argument-completions.spec.ts` | 48.7s / 3 | Keep a provider-owned completion and restart handoff. A CI retry occurred in goal toggling; isolate its cause and move pure command mapping lower. |
| `multi-host-secure-coexistence.spec.ts` | 47.0s / 14 | Keep secure coexistence. Resolve the [full-suite setup timeout gap](../../gaps/multi-host-e2e-setup-timeout.md) before altering its timeout or coverage. |
| `all-sessions-search.spec.ts` | 39.7s / 15 | Keep real sequential typing, streaming, and responsive behavior. Which search rules already have page/feed tests, and which desktop/phone repetitions add no new boundary? |
| `remote-login.spec.ts` | 36.0s / 13 | Keep real auth/transport. Compare its sidebar assertions with local and relay cases while preserving a route check on each transport. |
| `source-control-clean-landing.spec.ts` | 34.7s / 7 | Real Git and browser navigation matter. Separate state/preference decisions from the smaller set of browser and filesystem transitions. |
| `question-aside.spec.ts` | 34.5s / 1 | Existing hook tests cover some fork/save/steer rules. Keep a focused browser check for placement, focus, and navigation. |
| `file-viewer-comment.spec.ts` | 29.9s / 11 | Pointer, selection, and iframe behavior may need Chromium. Inventory viewport and content variants before consolidating. |

## Sequence

### First reduction slice — 2026-09-27

| Change | Browser coverage retained | Local evidence |
| --- | --- | --- |
| Wait for the `!!` POST receipt and cleared recovery draft before reloading; remove this test's commands after each attempt. Route cases assert their destination rather than an empty shared history, with the empty state checked in a page component test. | Command execution, reload persistence, local/remote/relay navigation, and the empty-history message. | Two repeats of each affected case passed on one shared server (6/6), including after correcting the cleanup to read `session.transcriptDisplayObjects`. The latest failed CI job showed the command completing before its held receipt, followed by a recovery draft on reload and shared history in later route cases. |
| Move creation-age presence/absence from two All Sessions browser cases into `SessionListItem.test.tsx`. | Real sequential typing against a large catalog, search updates, selection, scroll, and desktop/phone geometry remain in 13 browser cases. | Focused component and age-format tests passed (42/42). All 13 remaining browser cases passed. The removed cases took about 0.5s each in the earlier local baseline; one after run is insufficient to establish a spec-time gain. |
| Run the async reply failure/retry and persisted dismissal flow once on desktop. Retain a phone touch reply, focus, and viewport check. Wait for the emitted live message to render before testing scroll pinning. | Live question arrival, phone input behavior, failure/retry, draft and scroll preservation, 200 real sequential keystrokes, cross-session activity, and old-server fallback. | Two baseline repeats took 39.3s and 44.1s locally. Four reduced runs passed: 35.2s, 29.6s, 29.7s, and 30.2s. CI history is still needed to assess the known intermittent failure. |

Relay integration was also audited. Its three largest cases total about 27s
of the 57s CI median: large frozen public share (11.25s), large assistant
content (10.4s), and large user upload (5.55s). Each checks an actual bounded
encrypted transfer and its delivered content or upload, so a component test
cannot replace it. The remaining login, resume, stale URL, error, project
data, settings link, and route cases each exercise a different relay boundary.
No relay case was removed in this slice. The correlated route failure was
addressed through test isolation and a route-specific assertion.

The first post-change CI job passed 324 cases with no retries in 19m19s, about
1m20s below the baseline passing-job median. This single run is not a
steady-state job-time or flake-rate measurement; a comparable window remains
outstanding. The [ledger](../testing/e2e-ci-cost-ledger.md) records its setup,
case, and spec timings.

### Second reduction slice — 2026-09-27

| Change | Browser coverage retained | Local evidence |
| --- | --- | --- |
| Start the three-host relay harness once for both transport modes. The legacy disconnect case waits for the stopped server to exit, then the mux setup restarts only that host. | All 14 secure coexistence cases still run against real hosts and relay transport in both modes. | Focused run passed 14/14 in 1.1m including the shared E2E build. The historical setup timeout occurred only under full-suite load, so [the gap](../../gaps/multi-host-e2e-setup-timeout.md) remains open for CI evidence. |
| Share one Vite server across the three slash-completion cases, closing it after the spec. | Provider-owned completion, process restart, and goal toggling retain separate fresh pages. | Focused run passed 3/3 in 50.8s including the shared E2E build; reported case attempts totaled 17.8s. A comparable CI run is needed to quantify the setup savings. |
| Add named Playwright steps around the async-question scroll, Inbox menu, and older-server fallback checkpoints. | Its live stream, focus, scroll, transport, responsive, and real typing checks remain intact. | The final focused run passed in 33.2s. The edit keeps only useful checkpoints to avoid a thousand-line formatting diff. Splitting into independent cases would duplicate stateful setup and likely make this spec slower. |
| Remove five request-only Files browser cases. Existing server route tests already covered text content, download headers, traversal rejection, and missing files; a server test now covers the JSON MIME assertion. | The two actual browser cases still verify large HTML iframe behavior and active-content downloads. | This removes five listed browser cases with little expected wall-time gain: their baseline case attempts were about 0.01–0.31s each. |

The [artifact-grant protected-path alias gap](../../topics/active-content-security.md)
was also a real product defect exposed by local tests: a lexical comparison
could misclassify an owned path when an ancestor had a filesystem alias.
Ownership now compares resolved paths and the server regression covers an
existing alias and a future child. This is a correctness fix, not a suite
speed change.

The second slice's [full CI run](https://github.com/kzahel/yepanywhere/actions/runs/36325789955)
passed 319 cases with eight skipped and no retries. Its E2E job took 20m49s:
1m30s slower than the first slice's single run and 10s above the baseline
median. The slash spec's reported case time fell from 43.1s to 40.0s, while
multi-host rose from 36.2s to 38.9s and async questions from about 66s to
about 72s. The five request-only Files cases had too little execution time
to matter to the job total. These are single-run observations, so this slice
does not yet demonstrate a suite-wide speed reduction. The [ledger](../testing/e2e-ci-cost-ledger.md)
records the setup and case totals for both runs.

### Parallel execution experiment — 2026-09-27

The [paired CI measurement](../testing/e2e-ci-cost-ledger.md) compared the
same 327 listed cases on one runner and two isolated shards. Both shards
passed with no retries. The E2E gate fell from 20m17s to 12m36s in this
pair, while combined runner time rose from 20m17s to 23m29s. A local
`--workers=2` full-suite trial stopped after five failures and 186 passes,
so the local default remains one worker. Two more full E2E shard pairs passed
without retries on the same test source; their gate times from first shard
start were 15m17s and 12m22s, with the slower second pair affected by a
3m07s runner-start skew. Keep the CI shards for now and compare a longer fixed
window before treating the gain as durable or changing shard balance. The
[ledger](../testing/e2e-ci-cost-ledger.md) records each run and the unrelated
Windows persistence failure that passed on a targeted rerun.

### Repair shared-server isolation before further reductions

The [isolation gap](../../gaps/e2e-shared-server-isolation.md) is more urgent
than another worker or a few seconds of spec time. `global-setup.ts` creates
one server and data directory per invocation, not per case. The fixed serial
order and cleanup in some specs have allowed the full suite to pass, but they
do not prove independence. The local two-worker run failed, so ordinary
Playwright worker parallelism needs diagnosis before it is enabled. Two CI
shards are a useful bounded interim configuration: each runner starts its own
services and uses one worker, while tests inside each shard still share state.

1. Inventory specs that mutate remote-access credentials, relay settings,
   global defaults, session files, and shared project data. Start with the
   remote-login and relay pair and the earlier `!! Commands` contamination.
   Record the state each case assumes, changes, and restores.
2. Reproduce candidate interactions with each spec alone, in a focused pair,
   and in reversed order. Capture first-attempt failures and traces; do not
   treat a CI retry pass as an independent passing case.
3. Make setup and cleanup idempotent for cases that can share a server. Give
   cases with unavoidable global mutation a separate server fixture or a
   reliable reset. Avoid a server per test for read-only cases unless evidence
   requires it.
4. Verify the repaired cases alone, in the changed-order pair, and in a full
   sharded CI run. Once the known interactions are clean, repeat a local
   two-worker probe to see whether ordinary worker parallelism is viable.

The first focused pair probe used two workers and no retries. With the shared
server, `remote-login` and `relay-integration` had four failures among 26
cases (two in each file). A worker-scoped YA server and data directory for
`remote-login` removed the shared credential mutation; its mock session also
needed a current timestamp and provider enrollment. The repaired pair passed
26/26 in one run. This is evidence for per-file isolation of a mutating spec,
not a suite-wide parallelism result. A `--repeat-each=2` attempt was stopped:
Playwright ran duplicate `relay-integration` copies concurrently, producing a
relay login failure within the shared-server file itself. Further pair repeats
must be separate invocations, followed by the full sharded CI gate.

A full local `pnpm test:e2e` run with the default one worker and no retries
took 744.57 seconds (12m24.57s) wall time on 2026-09-27. Of 329 listed
cases, 319 passed, eight were skipped, and two failed. All 13 isolated
`remote-login` cases passed. The failures were in the All Sessions quoted-
diagnostics case (`route.fulfill: Route is already handled!`) and the long-
context effort fork case (an exact request-body assertion omitted the new
`creationProvenance` field). A focused rerun failed both again; All Sessions
then stopped earlier with one row instead of two. This run establishes the
local cost and exercises the isolated file in the full order, but it is not a
green full-suite gate or evidence about two-worker suite safety.

The two unrelated test failures were repaired without changing product code.
The All Sessions case now waits for both written fixtures to appear in the
retained catalog and lets the sidebar's `starred=true` feed pass through
without fetching and fulfilling it; the failing request was confirmed to be
that feed. The effort case checks the fork option fields while allowing the
new creation-provenance field. The complete All Sessions file plus the effort
case passed 16/16 locally with one worker and no retries.

Do not enable more workers or claim order independence based only on passing
shards. Continue cost reductions after the mutating-state inventory and first
pairwise diagnoses are recorded; retain the existing full CI gate meanwhile.
The numbered cost work below remains in the plan after this immediate priority.

### 1 — establish a comparable measurement ledger

- The [initial ledger](../testing/e2e-ci-cost-ledger.md) records run identity,
  case count, elapsed time, retry attempts, and final result across a fixed
  35-job window. It includes job setup and build time. Investigate the repeated
  `!! Commands` failures before classifying them as regressions or flakiness.
- Record each candidate's unique browser/server assertion and matching
  unit/component/route coverage before editing tests. Use a fixed local
  revision for before/after focused runs; compare CI medians across comparable
  windows rather than declaring victory from one faster runner.
- Keep a short table here for each completed slice: cases removed or moved,
  focused time before/after, CI wall-time trend, retry trend, and retained
  boundary. A slower or newly intermittent replacement is not a ratchet.

### 2 — isolate async questions and audit relay integration

- Start with the two slowest CI specs. Compare the 797-line async-question
  flow with its existing data and component tests. Move state-only variants
  lower while retaining live arrival, real typing, focus, and scroll coverage.
- Split the 797-line async-questions flow so failures identify one boundary;
  track its retry history after the change. Inspect the relay spec for
  redundant UI assertions or setup while retaining encrypted transfer,
  authentication, reconnect, and route coverage.

### 3 — review slash completions, multi-host, and All Sessions search

- Review these next three specs in CI cost order, then remote login, Source
  Control, question aside, and file-viewer comments. Preserve provider-process,
  secure coexistence, Git, selection, and transport contracts. Move duplicated
  UI rules down a level or share setup only after the distinct failure is
  identified.
- In All Sessions search, move ranking and diagnostic variants into existing
  page/feed tests where the browser adds no distinct assertion. Retain real
  sequential typing under expected catalog volume, streaming, selection,
  and responsive behavior at representative widths.
- For question aside, compare browser assertions with
  `useQuestionAside.test.tsx`; retain a short layout/focus/navigation smoke.
  For Source Control, compare preference/navigation state with existing unit
  tests while retaining real Git transitions.
- Investigate retrying cases through traces and [test time budgets](../../topics/test-time-budgets.md).
  Do not raise timeouts or add retries as a substitute for diagnosis.

### 4 — separate low-cost tests by the boundary they actually exercise

- Move the request-only cases in `file-browser.spec.ts` to server route tests;
  retain browser download, iframe, and active-content checks.
- Compare `settings-unsupported-category.spec.ts` and
  `project-new-session-cta.spec.ts` with their existing component/page tests.
  Keep only browser-specific navigation or network behavior not covered there.
- Put `route-lifetime.spec.ts` with Playwright harness checks. Evaluate a
  lightweight browser configuration for `glossary-term-metrics.spec.ts`,
  `tool-display-contracts.spec.ts`, and layout-only cases that do not need the
  full YA server. Keep real browser layout checks where CSS geometry matters.
- Review `session-defaults-layout.spec.ts` and
  `settings-provider-layout.spec.ts` for repeated option-state or viewport
  assertions. Keep the actual breakpoint and browser-geometry contracts.

## Closure criteria

Each slice passes its focused lower-level and browser checks, then the full CI
browser gate. It records the unique contract retained and before/after cost;
no tests are skipped or weakened to claim improvement. After the first two
slowest CI specs, review the measurements and reorder the remaining list by
observed removable cost. Close the plan only when the shared-state interactions
have been diagnosed and repaired, the suite has a stable measurement ledger,
the high-time specs have been reviewed, and a comparable CI window shows lower
median and high-percentile job time without a higher retry-pass rate or lost
boundary coverage.

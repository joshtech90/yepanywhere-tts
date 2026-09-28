# End-to-end testing

Topic: e2e-testing

## Purpose and boundaries

The default client Playwright suite builds the local and remote clients and
starts one YA server and relay per run, isolated from the developer's data. A
test in that suite should exercise a failure that a smaller boundary cannot
observe. Running an existing browser test after a change and adding a
permanent browser test are separate decisions.

Choose the smallest boundary that can falsify the observable contract:

| Contract under test | Preferred check |
| --- | --- |
| Parsing, ranking, state transitions, or request mapping | Unit test of the owning function or hook. |
| Control state, conditional rendering, keyboard behavior that does not depend on browser layout, or persistence through component mounts | Component test with representative data. |
| HTTP status, response body, access rule, or filesystem effect without browser behavior | Server route or service integration test. |
| Layout, pointer targeting, focus, selection, scroll, downloads, browser security, or real sequential typing | Focused browser test. Use a lightweight page or component fixture when the YA server is not part of the contract. |
| Session launch, live provider stream, authentication, relay, reconnect, or client/server compatibility across a real boundary | Full-app E2E test with the required services. |

Browser-specific does not automatically mean full-app E2E. A visual review or
one-time design capture follows [UI testing](ui-testing.md); it does not by
itself justify a permanent regression case. Keep the real key-by-key typing
coverage required by [AGENTS.md](../AGENTS.md) for affected input paths, at
their expected data volume and concurrent-update conditions.

## Current full-app isolation debt

The full-app suite has 109 spec files and 329 listed cases as of the
2026-09-27 full local run.
Playwright's default page fixture gives each test a fresh browser context,
but `global-setup.ts` starts one YA server, relay, and data directory for the
entire invocation. Most cases share those services and their settings,
sessions, and files. `remote-login.spec.ts` now starts a separate worker-scoped
YA process and data directory for its credential-mutating cases. The run's
temporary directory isolates the default services from the developer's data
and from other runs; it does not isolate cases using those default services
from one another. There is no suite-wide server reset between cases.

This is a significant reliability gap. With one worker, files run serially;
cleanup can make the usual order pass while concealing an order dependency.
With two workers, files can overlap on the same server.
The local two-worker full-suite trial stopped after five failures; remote and
relay specs interleaved while both mutating the same remote-access
configuration, although the trial has not established the cause of each
failure. A green serial or sharded run establishes that its particular
schedule passed, not that its cases are independent. CI retries can also
conceal a first-attempt failure.

Before expanding the full-app suite or optimizing its execution further,
prioritize test independence. For each mutating spec, identify shared server
settings, auth state, session files, and relay state; run it alone and beside
the specs that touch the same state, including a changed order. Make setup and
cleanup own that state explicitly, then verify the test passes without relying
on a preceding case. Use a separate server fixture where reliable reset is
impractical. Keep shared startup for read-only checks when it remains safe;
do not pay for a server per case without evidence that the boundary needs it.
When probing a pair with two workers, use one copy of each file per invocation.
`--repeat-each` can schedule two copies of the same file concurrently on the
shared server, so it does not repeat the same pairwise experiment safely.
The [E2E suite plan](../docs/tactical/135-e2e-suite-cost-ratchet.md) tracks the
isolation work and the [open gap](../gaps/e2e-shared-server-isolation.md) records
the observed failure.

## Adding or expanding a case

Before adding a Playwright case, identify the observable regression it would
catch, the boundary that makes a cheaper test insufficient, and any existing
test of the same behavior. Put data and option variants at the lower level;
keep one browser case for the browser-specific boundary. Add desktop and phone
variants only when the contract changes across those layouts. Avoid combining
independent flows into one long case: a failure should identify the behavior
that broke without replaying unrelated steps.

Account for marginal cost before adding a case: measured case and spec time,
full-suite setup cost if a new fixture is needed, CI retry history, fixture
complexity, and how often UI changes will invalidate its selectors. A case that
duplicates a lower-level assertion needs a distinct browser failure it can
catch. Cost alone does not remove transport, security, or real input coverage;
it prompts a narrower fixture or assertion.

When changing an existing feature, update affected assertions but do not add
another E2E variant merely because its neighboring tests live in Playwright.
Move API-only checks to server tests and pure state checks to unit/component
tests when doing so preserves their contract. Do not skip or weaken a failing
case to improve suite time.

## Verification cadence

During implementation, run the relevant unit, component, route, and focused
browser cases. From the repository root,
`pnpm --filter @yep-anywhere/client exec playwright test e2e/<spec>.spec.ts`
runs a selected browser spec. Use the full local browser suite when changing
shared browser fixtures, global setup, transport, routing, or another surface
whose affected cases cannot be bounded reliably. Existing release or migration
plans may require a full local run for their own gates. State which browser
scope actually ran in the handoff.

CI continues to run the full client E2E suite. A focused local run does not
turn a failing full CI run into a pass, and CI retries do not make an
intermittent assertion healthy. Visual verification and capture remain owned by
[UI testing](ui-testing.md), including a user's explicit visual-QA handoff.

The full-app Playwright configuration uses one worker because local workers
share its test services. For CI parallelism, separate shards can each start
their own services on isolated runners while keeping one worker per shard.
This isolates shards from one another, but cases *within* a shard still share
its server and must not depend on their execution order.
Compare the slower shard's wall time with the single-job gate and also report
the sum of shard job times as runner cost. A partial local run stopped by the
failure limit is not a valid speed comparison; the current measurements are in
[the E2E cost ledger](../docs/testing/e2e-ci-cost-ledger.md).

## Measuring value, time, and instability

For each reduction pass, record a fixed source revision, the cases changed,
their unique browser/server assertions, and the lower-level coverage that
replaces them. Measure before and after on comparable runs:

- Per-case and per-spec elapsed time, plus full job wall time and setup time.
  Report median and a high percentile across enough CI runs to distinguish a
  change from runner noise; a single local run is a prioritization signal.
- First-attempt failures, retry passes, and final failures by case and commit.
  Separate product regressions, broken fixtures/builds, and intermittent tests.
  Repeated failures across commits are not a flakiness estimate.
- Coverage retained at each boundary: which real browser, server, or transport
  failure would still be detected after a move or consolidation.

Review the slowest specs and any retrying case first, but prioritize removable
duplication over an expensive case with unique boundary coverage. Compare CI
history before changing timeouts; [test time budgets](test-time-budgets.md)
owns timeout evidence. The current reduction sequence and its baseline live in
[the E2E suite ratchet plan](../docs/tactical/135-e2e-suite-cost-ratchet.md).

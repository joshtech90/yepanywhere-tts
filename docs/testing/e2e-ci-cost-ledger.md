# Client E2E CI cost ledger

This log records comparable browser-suite measurements for the
[E2E reduction plan](../tactical/135-e2e-suite-cost-ratchet.md). The
[run-level CSV](e2e-ci-cost-baseline-2026-09-27.csv) preserves the source SHA,
elapsed time, case count, and retry counts for each job. The
[case-level CSV](e2e-ci-case-baseline-2026-09-27.csv) preserves 336 observed
case identities, passing-run duration medians and 90th percentiles, and their
first-failure, retry-pass, and final-failure counts. Run IDs in the first file
resolve under `https://github.com/kzahel/yepanywhere/actions/runs/<run_id>`.

## 2026-09-27 baseline — 35 main-branch CI jobs

Source: the latest 35 completed `ci.yml` runs on `main` when sampled, from
[run 35909851714](https://github.com/kzahel/yepanywhere/actions/runs/35909851714)
at 2026-09-23 19:31 UTC through
[run 36312838295](https://github.com/kzahel/yepanywhere/actions/runs/36312838295)
at 2026-09-27 10:32 UTC. Each run used the single-worker `e2e-tests` job.
Thirty jobs passed and five failed; the listed case count grew from 318 to
334 across these changing commits. One successful
[334-case run](https://github.com/kzahel/yepanywhere/actions/runs/36312160095)
is the fixed reference for inspecting individual case durations.

| Measure | Median on 30 passing jobs | 90th percentile | What it includes |
| --- | ---: | ---: | --- |
| Entire `e2e-tests` job | 20m39s | 21m05s | Checkout, install, browser install, test command, cleanup. |
| `pnpm test:e2e` step | 20m06s | 20m33s | Shared/client builds, services, then Playwright cases. |
| Before `Running … tests` | 1m49s | 1m53s | Setup and builds inside the test command. |
| From `Running … tests` to step end | 18m16s | 18m40s | Serial case execution, fixture overhead, reporting, teardown. |
| Sum of reported case attempts | 17m42s | 18m08s | Includes retry attempts; excludes skipped cases and between-case work. |

The medians of these components are calculated independently and therefore
need not add exactly. The separate `pnpm install` and Playwright browser-install
steps had passing-job medians of 3s and 8s. The successful reference run used
about 1m51s before cases and 18m15s afterward; its reported case attempts
sum to 17m44s. Case execution dominates job time, while every focused run
also pays the setup cost unless it uses a narrower fixture.

### Slowest specs in passing CI jobs

Each value is the sum of Playwright's reported case-attempt durations for a
spec within a job. Medians and nearest-rank 90th percentiles use the 30 passing
jobs; they are prioritization signals, not isolated-spec wall time. All listed
specs appeared in all 30 jobs.

| Spec | Cases per job | Median | 90th percentile | Reference run |
| --- | ---: | ---: | ---: | ---: |
| `async-questions.spec.ts` | 1 | 72.0s | 78.0s | 78.0s |
| `relay-integration.spec.ts` | 13 | 56.9s | 57.5s | 52.5s |
| `slash-command-argument-completions.spec.ts` | 3 | 48.7s | 52.0s | 48.6s |
| `multi-host-secure-coexistence.spec.ts` | 14 | 47.0s | 49.3s | 38.5s |
| `all-sessions-search.spec.ts` | 15 | 39.7s | 41.3s | 40.3s |
| `remote-login.spec.ts` | 13 | 36.0s | 37.7s | 33.1s |
| `source-control-clean-landing.spec.ts` | 7 | 34.7s | 35.0s | 34.7s |
| `question-aside.spec.ts` | 1 | 34.5s | 35.0s | 34.3s |
| `file-viewer-comment.spec.ts` | 11 | 29.9s | 30.4s | 30.2s |
| `artifact-viewer.spec.ts` | 12 | 28.9s | 32.8s | 32.8s |

The earlier local run ranked All Sessions search first at 37.4s and async
questions second at 35.2s. CI reverses that order, with async questions taking
roughly twice as long as in the local run. Subsequent reduction slices should
use the CI ranking and report both environments separately.

### First two contract inventories

`async-questions.spec.ts` is one 797-line case that visits the session,
Settings, Inbox, and sidebar at desktop and phone widths. Its distinct browser
checks include focus and scroll preservation during a live message, reply
failure and retry through the server, cross-session counts delivered over the
activity stream, phone overflow controls, a 200-character real sequential
typing sequence, and an older-server capability fallback. Existing
`asyncQuestions.test.ts`, `AsyncQuestionsButton.test.tsx`, and
`useDrafts.test.ts` already cover some reminder aging, compact button text,
and draft source isolation. `QuestionAnswerPanel.test.tsx` covers blocking
provider interviews, not async questions, so it is not replacement coverage.
Compare each repeated state assertion with the relevant tests before moving
it. The [known timing gap](../../gaps/async-questions-e2e-flake.md)
reported two failures in four unchanged local runs on 2026-09-24.

`relay-integration.spec.ts` has 13 cases around real encrypted relay login,
bounded transfer, refresh/resume, stale saved URL, error paths, and relay route
navigation. Its transport boundary is not replaceable by a mocked component
test. All cases share remote-access configuration and teardown; setup and
duplicated page assertions are the first costs to inspect. The `!! Commands`
route case failed alongside its local and remote counterparts in four CI jobs,
so it needs a shared-cause diagnosis before a coverage decision.

### Failures and retries

Twenty cases failed on their first attempt across eight jobs. Seven passed on
a retry; 13 remained failed. Six jobs had at least one retry pass, including
two jobs that still failed for another case. The five failed jobs comprise four
jobs where the same three `!! Commands` cases failed together across local,
relay, and remote routes, plus one earlier job with a persistent Files API
case failure. The latest three-case failure followed an intervening passing
run, so its cause needs investigation before classifying it as a product
regression or intermittent test behavior. No job in this window stopped during
compilation.

The seven retry-pass cases were one each in `session-right-pane`,
`slash-command-argument-completions`, `page-keys-after-scrollbar-drag`,
`all-sessions-search`, `artifact-viewer`, `source-selection`, and
`question-aside`. The four failed `!! Commands` jobs account for 12 of the 13
persistent case failures. Retry attempts added 43s of reported case time to
passing jobs and 289s to failed jobs across this window. These are observed
replays, not an estimated flake rate: source revisions and case counts changed
throughout the window.

### First follow-up diagnosis

The latest failed job's `!!` local-command attempt reached a completed command
before its held POST receipt settled. The test reloaded immediately, so the
recovery draft remained in local storage and its reload assertion failed.
Retries then encountered a command left in the shared server. The relay and
remote route cases were asserting that the global history was empty, so they
failed after the local test even though their own navigation worked. The
fix waits for the receipt and draft clearance, removes this test's commands
after each attempt, and checks the destination heading in the two route
cases. A focused component test keeps the empty-history assertion. Two
focused repeats of each of the three affected cases passed on one shared
test server after the cleanup correction. The first full CI run after the
change passed without retries; more runs are needed to assess the trend.

### First post-change CI sample

[Run 36324063569](https://github.com/kzahel/yepanywhere/actions/runs/36324063569)
on the first reduction slice (`f7193eee7`) passed on 2026-09-27. The job
listed 332 cases: 324 passed, eight skipped, and none retried. The E2E job
took 19m19s; its test step took 18m46s, including 1m37s before Playwright
began cases and 17m09s thereafter. The baseline passing-job medians were
20m39s, 20m06s, 1m49s, and 18m16s respectively. The async-question case
reported about 1.1m versus its 72s baseline median; the slash-completion spec
reported 43.1s versus 48.7s; multi-host reported 36.2s versus 47.0s.

This is one passing job at a different revision and case count, so the
differences are observations, not a measured steady-state gain or flake-rate
change. The second slice shares startup in slash completion and multi-host,
labels async-question checkpoints, and removes five API-only Files cases. The
following sample compares its CI job with this run; a fixed passing-job window is
still needed for a trend.

### Second post-change CI sample

[Run 36325789955](https://github.com/kzahel/yepanywhere/actions/runs/36325789955)
on the second slice (`12485f1c4`) passed on 2026-09-27. It listed 327 cases:
319 passed, eight skipped, and none retried. The E2E job took 20m49s; its
test step took 20m13s, including 1m50s before cases and 18m22s thereafter.
That is 1m30s slower than the preceding single run and 10s above the
35-job baseline median. The sum of list-reporter case durations was about
17m53s, versus 16m43s in the preceding run. Most of this observed difference
is in case execution, not setup.

| Spec | Baseline passing-job median | First sample | Second sample |
| --- | ---: | ---: | ---: |
| `async-questions.spec.ts` | 72.0s | about 66s | about 72s |
| `slash-command-argument-completions.spec.ts` | 48.7s | 43.1s | 40.0s |
| `multi-host-secure-coexistence.spec.ts` | 47.0s | 36.2s | 38.9s |

The five removed Files cases were almost free in reported execution time;
the Files spec took 2.5s across seven cases in the first sample and 2.8s
across two browser cases in the second. Moving them makes the test boundary
clearer but should not be credited with a wall-time saving. Shared startup
did not produce a measurable full-job gain in this one run. The slash spec's
reported case time improved, while multi-host and async-question times moved
upward from the preceding run.
These two post-change jobs have different case counts and are insufficient
to establish a median or retry trend. Keep the full CI gate and collect a
comparable window before closing the cost objective.

### Two-shard CI experiment

[Run 36327293044](https://github.com/kzahel/yepanywhere/actions/runs/36327293044)
is the single-worker control at the same test source revision as the sharding
change. It passed 319 cases, skipped eight, and had no retries. Its E2E job
took 20m17s, including a 19m43s test step.

The workflow-only change in
[run 36328686139](https://github.com/kzahel/yepanywhere/actions/runs/36328686139)
split the same 327 listed cases across two isolated CI runners. Each shard
kept Playwright at one worker and built and started its own test services.
Both shards passed without retries:

| CI run | Listed cases | Result | Job wall time | Test step |
| --- | ---: | --- | ---: | ---: |
| Single-job control | 327 | 319 passed, 8 skipped | 20m17s | 19m43s |
| Shard 1/2 | 165 | 157 passed, 8 skipped | 12m36s | 12m05s |
| Shard 2/2 | 162 | 162 passed | 10m53s | 10m16s |

The two shards started one second apart, so the slower shard set the E2E gate
at 12m36s: 7m41s (38%) shorter than the control. Their combined job time was
23m29s, 3m12s (16%) more runner time than the control because setup and builds
ran twice. The shard time difference was 1m43s. These are one paired CI
observation, not a steady-state speed or retry-rate estimate. Shard timing
should be compared over a fixed window before rebalancing files.

A separate local full-suite trial with `--workers=2` shared one test server.
It stopped at the five-failure limit after 186 passes, eight skips, and 127
cases not run; it took 4m48s before stopping. The failures included async
question scroll, file-viewer pointer targeting, relay transfer, and two
remote-login checks. The incomplete run cannot establish a local speed gain,
and the failures do not by themselves identify a common cause. Keep the local
full-app default at one worker unless a complete parallel run becomes reliable.

### Repeated two-shard CI checks

The workflow-only run above and subsequent runs used the same test source and
the same 327 listed cases. The later source revision changed only E2E guidance
and this ledger. Each row reports an entire required pair of shards; "gate
from first start" includes any delay before the second shard acquired a
runner.

| Run | Shard 1 job | Shard 2 job | Start skew | Gate from first start | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| [36328686139](https://github.com/kzahel/yepanywhere/actions/runs/36328686139) | 12m36s | 10m53s | 1s | 12m36s | 319 passed, 8 skipped, 0 retries |
| [36329637452, attempt 1](https://github.com/kzahel/yepanywhere/actions/runs/36329637452/attempts/1) | 12m10s | 10m29s | 3m07s | 15m17s | 319 passed, 8 skipped, 0 retries |
| [36329637452, attempt 2](https://github.com/kzahel/yepanywhere/actions/runs/36329637452/attempts/2) | 12m22s | 10m46s | 47s | 12m22s | 319 passed, 8 skipped, 0 retries |

All three E2E pairs passed. Runner queuing consumed part of the wall-time gain
in the second pair. The third workflow attempt initially failed outside E2E:
the Windows `persistence-native` job hit an `EBUSY` temporary-directory error
in `ReviewCaptureService.test.ts`. That failed job passed on a targeted rerun;
the workflow is green. The E2E shards were not rerun in that attempt. These
green E2E runs show that the shard layout can complete; they do not prove case
independence inside either shard or establish a stable failure rate. The
[shared-server gap](../../gaps/e2e-shared-server-isolation.md) remains open.

### Collection method and next comparison

Run selection used `gh run list --workflow ci.yml --branch main --limit 35`.
Job and step timestamps came from the GitHub Actions jobs API. Case identity,
duration, attempts, and the `Running … tests` timestamp came from each job's
Playwright list-reporter log. The CSV records job and step durations to whole
seconds and derived durations to tenths; percentile figures use nearest-rank
ordering. The case-level file groups by spec path and full Playwright title;
its duration columns use only passing jobs, while failure counts use all 35.

After the first reduction slice, collect another fixed window with the same
method. Compare passing-job median and high-percentile wall time at comparable
case counts and revisions, and report first-attempt failures, retry passes,
and persistent failures separately. Keep the unique browser or transport
assertions beside each removed or moved case in the tactical plan.

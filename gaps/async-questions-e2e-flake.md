# async-questions e2e spec fails intermittently

`packages/client/e2e/async-questions.spec.ts` ("async questions preserve
context, drafts, scroll and ordinary delivery") failed 2 of 4 local runs on
2026-09-24 at different assertions: the bottom-pinned scroll poll at line 268
(distance from bottom 4587, expected < 3) and a `toBeVisible` wait at line
785 (element not found). The other two runs passed unchanged, and the full
suite's other 310 tests passed alongside the first failure. Diagnose the
timing dependency; it stops `./publish.sh` at its verify stage.

Found 2026-09-24 during a publish of unrelated file viewer changes.
Contributing-model: opus-5.5

## Follow-up 2026-09-27

A timing probe on two unchanged local runs put the case at 39.3s and 44.1s.
The reply flow across both viewports took about 14s; Settings, reminder
aging, and real sequential typing took another 12s; Inbox and sidebar took
about 8s. The first bottom-pinning assertion followed an emitted live message
without waiting for that message to render. The reduced case now waits for
that rendering before the scroll assertion, runs the free-form failure/retry
flow once on desktop, and keeps the phone touch/focus/viewport reply check.
The first reduced local run passed in 35.2s; three further focused repeats
passed in 29.6s, 29.7s, and 30.2s. The intermittent final capability fallback
failure has not been isolated, and a CI retry trend is not yet available; keep
this gap open until those are checked.

The follow-up reduction labels the scroll, Inbox menu, and older-server
fallback checkpoints with Playwright steps, so failures at those known weak
points identify the phase in the report. The flow still shares the same test
server and page; this diagnostic change does not itself resolve the timing
dependency. The final focused run passed in 33.2s; CI retry history remains
the closure condition.

The first full-suite CI run with these checkpoints passed the case without a
retry ([run 36325789955](https://github.com/kzahel/yepanywhere/actions/runs/36325789955)).
The historical failure was intermittent, so this single run is not enough to
close the gap.

## Initial transcript readiness — 2026-09-30

The immutable built-client fixture reproduced the desktop pinning failure.
A bounded diagnostic recorded a captured return position with
`scrollHeight == clientHeight == 392`, no anchor, and sometimes `following=false`:
the initial bottom-distance poll accepted an unrevealed empty viewport. The
case now waits for the expected last-context row and actual overflowing volume
before the initial bottom check and question navigation. It preserves all reply,
historical-anchor, focus, typing, transport and older-server fallback assertions.
Four focused worker-two repeats passed without retries; the next full worker-four
run passed this case too. The earlier CI cold-source reload failure is avoided by
serving the private YA's immutable invocation bundle. Repeat exact CI first-attempt
evidence is still required before closing this intermittent gap.

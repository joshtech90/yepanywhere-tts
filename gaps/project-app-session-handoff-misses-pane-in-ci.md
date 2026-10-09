# Project App pane sometimes fails to appear after starting a session

[CI 37688149167](https://github.com/kzahel/yepanywhere/actions/runs/37688149167/job/113021178853)
at `0f24af3ad` failed `project-app.spec.ts`'s phone-switch/canvas case,
including its final retry. The URL reached the new mock session, but the
Project App region's iframe was absent after the five-second assertion at
line 448. This commit changed lifecycle diagnostics and instrumentation,
not the App pane runtime. The cause is not established.

A fresh isolated local run on the subsequent hardening source passed this
case without retries. That does not resolve the hosted failure. Investigate
session creation, project app metadata arrival and right-pane selection using
the retained CI trace before changing the timeout or product behavior.

The same job needed retries for two selection tests: the press-point setup
selected `Off` instead of `Reply `, and initial following was 252 px above the
bottom. The latter matches the existing
[follow-scroll gap](browser-follow-scroll-initial-activity-retry.md). Both
passed in the focused local run. These are separate from native reconnect and
are retained rather than hidden by rerunning CI until green.

[CI 37691081022](https://github.com/kzahel/yepanywhere/actions/runs/37691081022)
on `8610677ef` repeats the same missing-iframe assertion and passes on retry.
The general workflow is green, but the defect is not resolved.

Found 2026-10-07 while checking CI during Android lifecycle hardening.

2026-10-08: general CI `37698697131` on `7c7a1261c` again exhausts both
retries at the same session App iframe assertion (`project-app.spec.ts:448`),
with 194 other shard cases passing. This remains open independently of the
Android lifecycle repairs; no timeout or assertion was relaxed.

Final-source general CI `37704844755` on `c3d828c98` passes all 24 jobs,
with this same Project App case passing on retry. The other browser shard
passes without retries. Successful completion does not close this gap.

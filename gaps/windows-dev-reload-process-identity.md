# Windows dev-wrapper cleanup failure lacks process identity evidence

[CI 39472212993](https://github.com/kzahel/yepanywhere/actions/runs/39472212993/job/118798889435)
failed `packages/server/test/scripts/dev-reload-portable.test.mjs:135` after
the third reload: one previously recorded PID (7740) was still alive. The
preceding source revision passed the same Windows job. The intervening change
only repaired an unrelated RendezWatchService test fixture race.

The assertion checks every historical PID with `process.kill(pid, 0)` and the
failure log omits the fixture event journal and native process creation
identities. It therefore cannot distinguish a surviving owned descendant
from Windows reusing a retired PID. Neither explanation is established.
The isolated rerun passed on the same source revision; the original failed
attempt remains the evidence above.

Preserve the fixture events and capture process creation identities on failure
before changing process cleanup or its assertion. A passing rerun establishes
intermittence, not a root-cause repair. This is separate from the untested Unix
fallback process-group sweep in `dev-wrapper-process-group-reap-untested.md`.
Diagnosis is deferred because native Windows execution is required and the
current log cannot establish which process remained alive.

Found 2026-10-20 while validating desktop, npm, Android and website releases.

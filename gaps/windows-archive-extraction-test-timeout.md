# Historical Windows extraction stall remains unclassified

Graehl's computer-control Windows job failed the test “native extraction
rejects traversal and handles a valid ZIP” in
`packages/server/test/computer-control-releases.test.ts` at 5,003 ms against
the default 5,000 ms timeout. The other 31 assertions passed.

Evidence: [failed Windows job](https://github.com/graehl/yepanywhere/actions/runs/35085176248/job/104758200265).
The [origin Windows job](https://github.com/kzahel/yepanywhere/actions/runs/35085173084/job/104758191096)
passed on the identical `28a58cf9b` commit; both repositories' Linux legs
also passed. This suggests a timing flake rather than a deterministic
platform failure. Measure native subprocess startup and extraction before
deciding whether the integration test needs a longer explicit deadline.

Found 2026-09-16 while reporting source CI after speech-backend publication.
This Windows test issue is outside the speech implementation scope.

2026-09-30: the test now has an explicit 20,000ms budget, based on the earlier
5,000ms failure and successful 3,348ms/4,051ms observations. It nevertheless
timed out at 20,003ms in
[CI 36692427921](https://github.com/kzahel/yepanywhere/actions/runs/36692427921/job/109812489685).
The same job's first Windows process-ownership case took 24,140ms; its later
cases took roughly one second. These observations do not establish contention
or identify the blocked extraction stage.

Capture elapsed times for child spawn, traversal rejection, valid extraction
and child exit, with bounded stderr on failure. Compare a serial native-file
run against the current parallel invocation before changing another timeout.
The native PowerShell helper permits 120 seconds per child while the test
permits 20 seconds for two calls.

2026-09-30 follow-up: native responses now wait for `close`, preserving stdout
delivered after `exit`. Extraction accepts the installation/test abort signal,
kills cancellation and joins close before staging cleanup. The Windows fixture
also joins outstanding extraction calls in `afterEach` and reports elapsed
traversal/valid phases on failure. Six portable mocked-process regressions cover
these lifecycle boundaries; neither archive assertion nor the 20-second budget
was relaxed. The newer CI 36702832972 passed Windows on the preceding source.
The configured local Windows testbed is unavailable, so a source CI Windows
run is still needed to classify the earlier 20-second timeout and verify the
native implementation. Lifecycle repair alone does not establish its cause.

Source [CI 36712930735](https://github.com/kzahel/yepanywhere/actions/runs/36712930735/job/109878806076)
now passes all 43 Windows computer-control assertions on the first attempt.
The extraction case took 4,341ms under the unchanged parallel invocation and
20-second test budget. This verifies the native repair on Windows; the earlier
20-second stall remains unclassified unless its new bounded diagnostics recur.

Follow-up [CI 36715163980](https://github.com/kzahel/yepanywhere/actions/runs/36715163980/job/109886184957)
also passed all 43 assertions on the first attempt, with extraction at 4,323ms.
Both complete source CI runs passed their browser and unit suites as well.

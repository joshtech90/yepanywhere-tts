# Windows archive extraction test can exceed its five-second timeout

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

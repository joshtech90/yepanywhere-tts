# Native phone browser proof intermittently duplicates its first character

[CI 39474867379](https://github.com/kzahel/yepanywhere/actions/runs/39474867379)
passed all 24 jobs, but `packages/client/e2e/native-webview.spec.ts` retried its
phone case after the exact-value assertion at line 220 received
`NNative transport keeps every key responsive during incoming updates.`
instead of the same sentence with one initial `N`. The test had recovered an
offline draft, cleared it, and typed sequentially during 20 Hz / 1 MiB native
state frames. Its retry passed with all 68 keys and a 22.9 ms maximum.

Three focused local runs without retries passed (17.5, 15.2 and 15.0 seconds;
key maxima 12.9, 16.0 and 13.0 ms). They did not reproduce or explain the
duplicate. Neither a fixture-only cause nor a real draft/input race is
established. This differs from the pre-typing Loading screen failure in
`native-webview-browser-composer-readiness.md`.

The failed screenshot/context and successful retry trace are retained in the
run's `e2e-failures-shard-1-1` artifact and locally under
`tasks/release-2026-10-20/ci-green-browser/`. A failed-attempt trace or targeted
input/draft event capture is needed to locate the extra insertion. Keep the
exact-value and per-key 100 ms assertions; a retry pass is not a repair.
No input code, assertion, timeout or retry policy changed during this release.

Found 2026-10-20 while checking coordinated release CI.

# Live session search sometimes misses a newly discovered match

The remaining finding is
`packages/client/e2e/all-sessions-search.spec.ts:204`: the newly discovered
session's `quasarneedle live beta original request` did not become visible
within 30 seconds on the 2026-09-30 full local run. This has not been
classified; capture the actual collection request, discovery/baseline state,
response and client reconciliation before changing the assertion or deadline.

The remaining live case passed three focused repeats and a full 352-pass
four-worker browser run on September 30 with retries disabled. Fixture home
and development-reload settings are now isolated; those independently explained
seven other failures in the preceding full run. The historical missing-beta
report still has no captured discovery/response cause, so its deadline and
product search behavior remain unchanged.

## Original evidence

The post-publication browser suite on source `8c9c0d784` reported 339 passed,
11 failed, and 10 skipped on 2026-09-30. Failures need diagnosis; this run does
not establish whether they are product regressions, fixture mismatches, or flakes.

- `packages/client/e2e/artifact-viewer.spec.ts`: nine failures (tests declared
  at lines 122, 204, 374, 424, 474, 511, 586, 697, 713). Expected preview
  frames, Edit/Run controls, artifact settings, or public-copy controls were
  absent. Start by checking capability advertisement and fixture setup.
- `packages/client/e2e/mockup-export.spec.ts:35`: exported preview failed.
- `packages/client/e2e/all-sessions-search.spec.ts:204`: the newly discovered
  session's `quasarneedle live beta original request` never became visible
  within 30 seconds (assertion at line 248).

Local evidence: `.artifacts/publish/run.HWMSSn/18-verify.out` and `.err`;
screenshots under `packages/client/test-results/58317e21-68a7-46da-ac4a-36f9d054f160/`.
Reproduce with `pnpm --filter client exec playwright test` and the three spec
paths above. These areas are outside the draft-notice correction; no broad
test-suite repair was attempted. The four draft tests in that full run passed.

Source CI on the same tip also failed `e2e-tests (1/2)` in
[kzahel CI](https://github.com/kzahel/yepanywhere/actions/runs/36674187772)
and [graehl CI](https://github.com/graehl/yepanywhere/actions/runs/36674190907).
Graehl additionally failed `computer-control (windows-latest)`. Their causes
have not been compared with the local failures. Both repositories passed
Server Runtime And SQLite, Android App CI, and Desktop CI; the local relay
e2e check passed.

Found 2026-09-30 while publishing the draft-notice fix.
Contributing-model: 6-Astra

## Artifact failures diagnosed and repaired — 2026-09-30

All five retry traces from
[CI 36692427921](https://github.com/kzahel/yepanywhere/actions/runs/36692427921)
recorded `Cannot access 'fileApi' before initialization` at the API facade's
eager `...fileApi` spread, before any backend API request. The dependency loop
is `fileClient -> sourceApiFetch -> sourceRuntime -> api/client -> fileClient`.
The new direct import in `FileResourceActions` exposed that loop from the
artifact viewer entry; missing controls were consequences of module failure,
not capability advertisement or startup deadlines.

File actions now call the existing API facade, whose file methods forward on
invocation instead of eagerly copying `fileApi` during module evaluation. Fresh
native-ESM Chromium checks import both `fileClient` and `ArtifactPreview` without
preloading that facade, preserving the entry orders the mocked component tests
did not exercise. Existing facade request tests retain each file endpoint's
parameters and body. Restoring the eager spread and direct component import
in served source reproduces the initialization error; production files need
no mutation for that probe. This closes the artifact findings. The live-search
finding above remains open; the API/runtime dependency loop still exists but
no longer forces an early read of `fileApi`.

# Windows review storage transitions can exceed the unit-test deadline

The Windows persistence job in [CI run 37712390681, attempt 1](https://github.com/kzahel/yepanywhere/actions/runs/37712390681/attempts/1)
failed `ReviewStorageTransition.test.ts:78`, "preserves the newest logical
revision across repeated toggles": Vitest stopped it at the default 5,000 ms
deadline and reported 5,279 ms. The other 345 tests passed and one was skipped.
The same-source rerun passed. A successful rerun clears that run's merge gate
but does not explain the first timeout.

The case performs real durable comment writes and three storage-mode
transitions, then checks revisions and transition-journal removal. These
assertions concern durability and ordering, not speed. The failed PostCSS
selector-parser PR changes a build-tool dependency, not these storage paths.
No storage implementation, assertion or timeout was changed during the
dependency pass.

Measure the Windows phases and distinguish filesystem latency from a stuck
transition before changing its fixture or budget. Follow
[test time budgets](../topics/test-time-budgets.md), including the observed
5,000 ms limit when deriving any justified deadline. Do not classify the
unexplained failure as a runner flake or weaken the durability assertions.
The separate [Windows full-suite baseline](windows-validation-baseline.md)
remains open; passing focused persistence jobs do not close that aggregate.

Found 2026-10-08 while following Renovate PRs through CI and merge.

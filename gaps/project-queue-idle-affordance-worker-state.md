# Idle Project Queue browser check can see a queue action

[CI 39164804828](https://github.com/kzahel/yepanywhere/actions/runs/39164804828)
failed the first attempt of
`packages/client/e2e/project-queue-idle-affordance.spec.ts`, then passed on
its fresh-worker retry. The desktop snapshot contained one `Queue for Project
Queue` button while the test expected none. The unchanged five-second assertion
observed it throughout the wait; this was not a missing-element timeout.

The test uses the worker's shared mock project and session without explicitly
establishing the complete project-idle predicate. Diagnose prior worker state
versus the affordance predicate before changing production behavior or the
assertion. Preserve the desktop and phone coverage. The uploaded first-attempt
snapshot and retry trace are in `e2e-failures-shard-2-1` on that run.

Left separate from the deterministic rendez settings selector repair because
the retry result does not establish the queue failure's cause.

Found 2026-10-18 while repairing CI for a clean-tree commit.

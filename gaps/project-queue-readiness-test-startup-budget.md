# Readiness-check reuse test gives Node only 100 ms to start

`packages/server/test/services/ProjectQueueReadinessCheck.test.ts`, in
"kills a timed-out check and allows another check", uses the same 100 ms
deadline for an intentionally hung child and the subsequent successful Node
process. Under a full CI workload, the second process can hit that deadline
before exiting normally. CI run `34195494832` failed this assertion on
`fb909d664`; its unit job passed on retry.

Give the real-process test enough startup headroom while retaining both the
hung-child termination and same-instance reuse assertions. Do not change the
runtime's timeout behavior. This adjacent test-budget issue was left outside
nightly delivery work; the selected release source had already passed CI.

Found 2026-09-08 while validating signed desktop nightlies.

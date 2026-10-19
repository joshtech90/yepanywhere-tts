# Process exit can make listener shutdown report ESRCH

`packages/server/src/utils/portListener.ts` reads `/proc/<pid>/stat`
while waiting for an identified listener to exit. `listenerStillRunning`
recognizes `ENOENT` as an exited process, but a read can also fail with
`ESRCH` when the process disappears during that operation.

The quick suite on 2026-10-16 failed in
`packages/server/test/artifacts/vhost-app-control.test.ts`, case
"allows a listener more than 1.5 seconds for SIGTERM cleanup":
`ESRCH: no such process, read`, from `processIdentity` through
`stopIdentifiedListener`. All four tests in that file passed on an immediate
focused rerun. The affected implementation was unchanged by the path-link
refactor under validation.

Keep this separate from path linking. A targeted fix should recognize the
observed process-disappearance error in `listenerStillRunning`, retain other
errors, and cover the read race without weakening process-identity or
replacement-listener safeguards.

Found 2026-10-16 while verifying shared HTML path scanning.
Contributing-model: 6-Astra

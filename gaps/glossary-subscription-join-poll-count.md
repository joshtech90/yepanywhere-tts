# Glossary subscriber test can exhaust its event-loop retry count

The full unit suite failed on 2026-10-16 in
`packages/server/test/projects/projectGlossarySubscriptionManager.test.ts`,
case `shares one post-observation snapshot barrier across concurrent joiners`,
with `Subscribers did not attach`. The server suite reported 527 passing files
and this one failure. This happened while validating a client-only Esc
interrupt preference; another agent was editing project-app code concurrently.

The test waits for three subscribers using at most 1,000 `setImmediate`
iterations. That count does not establish a wall-clock readiness budget for
the asynchronous subscription setup. A scheduling-sensitive fixture is a
candidate cause, not an established diagnosis. Preserve the test's shared
snapshot-barrier assertion while investigating the attachment wait; prefer a
readiness signal or a bounded time-based wait over an event-loop turn count.

Left separate from the Esc option because the failure concerns server glossary
subscription coordination, not composer input. A passing retry alone does not
resolve the intermittent failure.

Found 2026-10-16 while validating the Esc interrupt opt-out.
Contributing-model: 6-Astra

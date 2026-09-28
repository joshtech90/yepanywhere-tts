# A session start that waits for a worker loses its launch metadata and creator

When the Supervisor's worker pool is full, `Supervisor.startSession` and
`createSession` enqueue the request and the session routes answer 202
(`isQueuedResponse` in `packages/server/src/routes/sessions.ts`, on
`POST /projects/:projectId/sessions`, `.../sessions/create`,
`POST /sessions` and `/sessions/create`). The route returns there, before
`persistLaunchMetadata` and, for a limited user, `recordSessionCreator`.
When a worker frees up, the queued request starts through `WorkerQueue` and
runs only the `onStarted` callback the route passed in, which initializes
heartbeat defaults and nothing else.

So a session that waited records no provider, executor, requested model,
initial prompt, workstream, or sandbox level/state key/network firewall.
Later reads of those facts fall back to their absent-value defaults: a
sandboxed session can be resumed without its sandbox, and a limited user's
queued session has no `createdByUser`, so it is not theirs to read and a
resume by them is refused as unsandboxed.

Not fixed in place: it is a different mechanism from the usage-ledger item
that surfaced it, and the fix changes when launch metadata is written.
Cheap fix sketch: move the route's post-start writes (`recordSessionCreator`,
`persistLaunchMetadata`, the workstream) into the `onStarted` callback each
route already passes, so the direct and queued paths share one owner, and
cover a queued start whose worker frees up in a route test.

Found 2026-09-26 while fixing harsh review [9-3] (usage ledger coverage),
which now counts such a start when it is accepted.

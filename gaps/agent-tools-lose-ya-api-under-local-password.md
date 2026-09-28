# Agent tools lose the YA API once a local password is required

Agent sessions receive `AGENT_SERVER_URL` and the artifact origin
(`packages/server/src/app.ts` `getSessionChildEnv`,
`packages/server/src/artifacts/agentEnvironment.ts`) but no credential for the
YA HTTP API. With **Require Password** on, a tool such as
`pnpm artifact:capture` asking `POST /api/artifacts` for a link receives 401,
so captures land on disk without being presented, and the same holds for any
other API call an agent makes. Session wake and browser-debug callers are
unaffected because each carries its own scoped token.

Verified 2026-09-28 on an isolated server: `POST /api/artifacts` reached its
handler before `POST /api/auth/enable` and returned 401 after it.

Not fixed in place: it needs a scoped per-session credential (which routes an
agent may call, its lifetime, and how it survives server reload), an
authorization design rather than a patch. The sandbox-scoped endpoint ideas in
`topics/provider-host-api.sketches.md` are the nearest prior design.

Found 2026-09-28 while documenting local access passwords.

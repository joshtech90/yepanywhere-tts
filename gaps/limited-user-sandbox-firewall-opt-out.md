# A limited user can turn off their session's network firewall

The limited-user launch policy forces `sandboxLevel: "project-write"` but
leaves `sandboxNetworkFirewall` as the request sent it.
`limitNewSessionLaunch` in `packages/server/src/auth/limitedLaunchPolicy.ts`
sets the level and the lock only; the create routes in
`packages/server/src/routes/sessions.ts` then pass the request's
`sandboxNetworkFirewall` to `parseSessionSandboxLevel` unchanged. A create
request with `sandboxNetworkFirewall: false` therefore starts a limited user's
session on shared host networking. `limitExistingSessionLaunch` likewise
accepts a sandboxed session whose firewall is off.

Without the firewall, the limited user's agent can reach the YA listener,
local-network services, and unauthenticated localhost services such as the
maintenance server when `MAINTENANCE_PORT` is set. That server's `/reload` and
inspector endpoints have no credential. The other limited-user launch rules
treat the sandbox as "not the user's to clear"; the firewall is part of that
sandbox (`topics/session-sandbox-network-boundary.md`).

Not fixed in place: this was found while documenting the boundary in
`topics/security.md` § Limited Users, which records the gap as a stated
exclusion. Tightening the boundary is a behavior change that needs its own
decision.

Cheap fix: in `limitNewSessionLaunch`, refuse `sandboxNetworkFirewall: false`
or force it to `true`. In `limitExistingSessionLaunch`, refuse a session whose
settled firewall is off. Then remove the exclusion bullet from
`topics/security.md` and add a row to `topics/limited-users.md`. Add a route
test showing that a limited create with the firewall off is refused or
launched with it on.

Found 2026-09-26 while fixing harsh-review F17 (security topic boundary).

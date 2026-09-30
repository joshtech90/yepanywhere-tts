# A new-session tab takes seconds to show what every open tab already knows

Priority: **top** (maintainer, 2026-09-30). Opening `/new-session` in a new
tab is a routine action. It must show the composer, the current provider,
model and effort selection, and the project selector at once, then fill in
detail lazily. Today each of those waits on a serial chain of requests to a
server that already holds, and other open tabs already display, the same
current state.

## Observed

On the maintainer's live dev server, about 1.5 s after opening
`/new-session?projectId=…` in a new tab the pre-boot composer (see
[early typing handoff](../topics/early-typing-handoff.md#pre-boot-composer))
is still standing in for the form. The real form arrives about 5 s later.
The sidebar session list, provider details and projects finish later still.

## Measured (isolated instance, 2026-09-30)

A throwaway `YEP_PROFILE` dev instance on this host, scanning the same
`~/.claude` and `~/.codex` transcripts, loaded with headless Chromium (warm
server, 1400×800). Times are from navigation start:

| Milestone | Form waits for project | Form does not wait |
| --- | --- | --- |
| Pre-boot composer focused | 12–15 ms | 12–15 ms |
| App shell rendered | 320–355 ms | 326–345 ms |
| First `/api` request (`/api/settings`) | 717–784 ms | same |
| `/api/providers` done | 809–908 ms | same |
| `/api/projects/:id` + `/api/recents` issued | 1123–1261 ms | same |
| Real composer focused (pre-boot adopted) | 1420–1566 ms | 1107–1284 ms |
| Provider name shown | 1440–1593 ms | 1229–1261 ms |
| Sidebar sessions loaded | 1533–1694 ms | 1280–2008 ms |

The second column is after the fix that lets the form take typing at once and
hold only Start until the selected project's record arrives. The remaining
chain on an unloaded server is:

1. About 700 ms of unbundled development-module loading before any request.
2. Bootstrap requests (`settings`, `auth/status`, `onboarding`, `version`,
   `settings` again), then `providers`, before the route renders.
3. About 300 ms more before the route issues its own requests: the lazy
   route chunk and first render.
4. The sidebar's four session-list requests and `/api/projects` start only
   after the route's `/api/projects/:id` and `/api/recents` complete (route
   bootstrap tier before navigation tier). The sidebar time varies with that.

A cold server (first load after restart) took 6.1 s for `/api/projects`,
6.6 s for `/api/recents` and once 11.6 s for `/api/providers`.

The live server is much slower than this instance. In the 27 minutes after
its 15:30 restart, the server log shows 169 Codex reader scans (mean 608 ms,
max 2.4 s, 103 s total) and 74 Codex scanner walks (mean 471 ms, max 4.6 s).
Event-loop delay reached 1.5 s (p99 about 71 ms). Each serial link above
waits behind that.

## Wanted

- **Instant first paint from last-known state.** A new tab renders the
  composer, current provider/model/effort, and project selector from a
  snapshot every open tab keeps current (browser storage or a
  `BroadcastChannel`), marked stale until the server confirms it. The
  session list and sidebar may follow.
- **One current truth on the server.** Providers, projects and recent
  sessions are maintained incrementally and served from memory. They are
  pushed to subscribed tabs, not recomputed per request, so no request in the
  new-session path waits on a transcript scan.
- **No serial bootstrap chain.** Route data requests start together with the
  bootstrap requests, not after them.
- **The pre-boot composer shows the existing new-session draft.** Otherwise
  a user who does not see it retypes, and adoption appends the retyped text
  after the restored draft (topic rule 2), sending the start twice. This
  needs the draft's account-scoped storage key, which is known only on the
  local path before the app loads.

Found 2026-09-30 while diagnosing duplicated new-session prompts and
multi-second new-tab loads. Contributing-model: opus-5.5.

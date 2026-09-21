# One project may host several app entry points, and the App action knows one

The header App action and its sidebar chip resolve to exactly one app: the
latest URL announced by this session's tool results
(`packages/client/src/hooks/useSessionRightPane.ts`, `apps.at(-1)`), launched
by the single-target button in
`packages/client/src/components/SessionRightPane.tsx`. A git-controlled
project can host several entry points — a docs site, an admin console, a
storybook, a second service — and nothing in the pane lets the user reach one
the current session never printed.

Two related extensions, neither bounded enough to implement as filed:

**A registered entry-point chooser.** Right-click (long-press on touch) on the
App action could offer the project's registered entry points, with the current
latest-announced app as the ordinary left-click default, preserving today's
non-buggy behavior. The registry source is undecided: a project-root `APPS.md`
listing name, URL or port, and description is the user's suggestion and is
git-shareable and agent-writable; the alternative is YA-side project state
next to the operator vhost table in Apps settings, which needs no repository
convention but is invisible to the project's collaborators. A registry entry
is a claim, not a live process — resolution must go through the same vhost
rewrite and listener check as an announced URL, and must not present a dead
port as a working app. Whether an `APPS.md` row can name a start command, and
who may run it, is a separate lifecycle question owned by
[app lifecycle](app-lifecycle.md).

**The session should know when the user chose the app.** Today every app the
pane shows arrived from the session's own tool output, so the agent can assume
the pane shows what it just started. A manual selection — chooser, registry
entry, or an app announced by a different session — breaks that assumption
silently: the user asks about "the app" while the agent reasons about the URL
it last printed. A manual switch should become session-visible state the agent
can read, distinguished from a session-initiated one. Placement and cost
belong to [agent context injection](../../topics/agent-context-injection.md);
an unconditional per-switch injected turn is not assumed to be the answer.

See [session right pane](../../topics/session-right-pane.md#vhost-tool-urls)
for discovery, rewriting, and listener-check rules any chooser must reuse.

Found 2026-09-20 while reviewing the App action's single-target assumption.

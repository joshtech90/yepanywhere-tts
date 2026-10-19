# Session references in viewed artifacts should open the YA session

Static dashboards and reports that agents generate name sessions: a
program dashboard lists the live `.agentctl/active` sessions working on each
paper and the session that authored each paper's last commit (from the
agentctl `agent-session` Git note). Today those appear as bare ids or as
outsider-safe text. Inside YA's artifact viewer, App pane or side pane, the
user wants a click on such a reference to open YA's own view of that session.
The same artifact opened outside YA, or shared with someone who has no YA
access, must still read correctly and must not expose a YA route.

Worked case (graehl, 2026-10-15): the `~/draft` project app
(`.project-template/app.json` → `research/index.html`, written by
`scripts/research_index.py` in that repository) shows session ids per
program and paper.

## Proposed shape

- **A link convention the artifact can emit without knowing YA.** For
  example an element carrying `data-ya-session="<id>"` around the visible id,
  with no `href` or an inert fallback. Outside YA it is plain text; nothing
  points at a YA origin. A URL scheme such as `ya-session:<id>` is the
  alternative; it degrades worse because browsers show it as a broken link.
- **Viewer-side interpretation.** Artifacts are served on an isolated app
  origin, so the viewer cannot read their DOM. Either the artifact frame
  posts a message (`{type: "ya-open-session", id}`) that the viewer accepts
  only from frames it granted, or YA's static serving injects a tiny
  click-delegation script into granted HTML. The second needs no artifact
  cooperation beyond the attribute but changes served bytes, which
  [active content security](../../topics/active-content-security.md) must
  allow.
- **Resolving an id to a route.** Every session route is
  `/projects/:projectId/sessions/:sessionId`, and an artifact knows only the
  session id. YA needs a session-id lookup (server catalog) that returns the
  project and canonical YA session id, or a session-only redirect route.

## Unresolved decisions

- **Which id artifacts carry.** Under YA, `AGENTCTL_SESSION_ID` is the YA
  session id, but the agentctl commit note records the harness-native
  resumable id. [Provider session identity](../../DEVELOPMENT.md#provider-session-identity)
  makes the YA id canonical, so the lookup must map provider-native ids too,
  or emitters must prefer the YA id.
- **Where the session opens.** Navigate the main view, open in the side pane
  beside the artifact, or a new tab; probably the main view, keeping the App
  pane open.
- **Unknown or inaccessible ids.** A session from another host, a deleted
  transcript, or one the principal may not view must fail visibly in the
  viewer, never as a silent no-op or an empty route.
- **Default.** YA-novel behavior ships configurable and default-off
  ([vanilla defaults](../../topics/vanilla-defaults.md)).

Related: [committed-change session attribution](committed-change-session-attribution.md)
(commit → session links in Source Control) and
[project app entry points](project-app-entry-points.md).

Found 2026-10-15 while building the `~/draft` research programs dashboard as a
project app.

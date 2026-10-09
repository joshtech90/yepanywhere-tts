# The agent cannot see which app or artifact the user has open beside it

A session's agent knows only the URLs and files it printed itself. What the
user is actually looking at is invisible to it: the app, artifact or file
viewer in the [session right pane](../../topics/session-right-pane.md), a
project app opened from the sidebar, or an app another session announced.
When the user asks about "the app" or "this page", the agent reasons from its
own last printout.
[Project app entry points](project-app-entry-points.md) names the manual-switch
case. An [MCP App view](../../topics/mcp-apps.md) adds more such state.

**Status (2026-10-06): the pull read through the shell is implemented.**
Tabs publish their views, the server forwards them to the provider owner, and
`ya-agent view` reports them per tab with a default selection; the contract is
[agent self § View inspection](../../topics/agent-self.md#view-inspection).
It reaches only launches that `ya-agent self` reaches (local Claude variants
and bypass-permission Codex, with `YEP_AGENT_SELF`). What remains below is
the non-shell adapters, an MCP App view kind, and the push notice.

The crux was that the server does not have this state: pane contents and the
Appearance setting are browser-local, and several clients may show the same
session differently. Clients now publish `{kind, label, target, url,
openedBy, state, placement}` per viewer with a per-tab id and focus time, and
the report never merges clients. An MCP App view would be a new `kind`.

**Pull before push.** The read belongs in one service API, per the
[agent command runtime](../../topics/agent-command-runtime.sketches.md#decision-summary)
layering. Its first consumer, now built, is `ya-agent view` beside
`ya-agent self` ([agent self](../../topics/agent-self.md)), which reaches any
eligible provider that has a shell. Other adapters would call the same API:

- **MCP server.** This is the generic answer to "can Codex see it via MCP".
  YA would inject a per-session server, for example
  `-c mcp_servers.ya.url=...` with the launch's session credential, and
  register the equivalent server for Claude. It brings one tool surface to any
  MCP client. Its cost is a new endpoint and credential path, and Claude's
  sandbox lockdown currently removes all MCP. The runtime proposal already
  calls MCP "another adapter rather than the first provider-neutral delivery
  mechanism".
- **Codex dynamic tools.** These are experimental. `thread/start`'s
  `dynamicTools` registers client-executed tools, which Codex calls back through
  `item/tool/call`. YA already answers that callback with a stub ("No dynamic
  tool is registered for this session", `packages/server/src/sdk/providers/codex.ts`).
  It needs no config injection, network listener or MCP lockdown exception,
  but it reaches only Codex.

The same read reaches the other providers through their own native hooks:

- **Claude.** The Agent SDK in this tree (0.3.283) offers an in-process MCP
  server through `createSdkMcpServer`. This is the Claude counterpart of Codex
  dynamic tools: no listener, no credential, and the tools appear as
  `mcp__ya__*`. Sandboxed launches set `mcpServers: {}` and disallow `mcp__*`
  (`packages/server/src/sdk/providers/claude.ts`). It is not network-reachable,
  but it is still a new tool authority.

**Sandboxed sessions (user-directed 2026-10-06).** When the view feature is
enabled, YA's own view server is the one exception to the sandbox MCP
lockdown ([session sandboxing § Claude MCP and connectors](../../topics/session-sandboxing.md#claude-mcp-and-connectors)).
For Claude that means passing only the in-process `ya` server and narrowing
the `mcp__*` deny to everything except `mcp__ya__*`. Configured servers,
Claude.ai connectors and remote servers stay disabled. The exception covers
YA's server alone, and only its read-only view tools. Any later YA tool that
can act needs its own review before it passes the lockdown. Sandboxed Codex
and ACP launches get the same single-server exception through their own MCP
configuration.

Limited users' sessions are sandboxed, so they inherit this exception.
Limited users' tabs are currently refused when they report a view (the route
is a session mutation no limited grant allows). Their agent would therefore see
no clients until a session-view report is allowed under `view` access on that
session.

Whether a sandbox may allow other MCP servers, chosen per sandbox level or per
limited user, is a separate question. Sandbox settings may later offer that
granularity, and [sandbox MCP allowlist](sandbox-mcp-allowlist.md) sketches
its settings and UI. The view server's exception does not depend on that
work.
- **pi.** YA already loads a bundled extension into every pi session
  (`packages/server/src/sdk/providers/pi-yep-anywhere-extension.mjs`).
  `pi.registerTool()` there can expose the read. pi has no MCP by design, so
  this extension and the shell command are its only adapters.
- **ACP agents (Gemini, Grok).** Session creation takes `mcpServers`, and YA
  passes `[]` (`packages/server/src/sdk/providers/acp/client.ts`). Passing the
  per-session YA MCP server gives the read to every ACP agent at once.
- **Any harness with a shell.** The `ya-agent` command, with no adapter.

A push variant notifies the agent only when the user, not the session, changes
the view. The notice is appended before the next user turn and is never an
injected turn per switch. It must pass the cost and placement review in
[agent context injection](../../topics/agent-context-injection.md). An MCP App
view's `ui/update-model-context` is the same class of fact and should share
this channel.

**Push only on user request.** Most sessions have no workflow that wants view
changes in context, so an always-on push would charge every session an
injection cost for value few of them get. Two user-activated forms avoid that,
and either one tells YA the user expects the notice to be worth its tokens:

- **One-time gesture.** One uniform glyph, the same on every viewer, means
  "tell the agent I am looking at this". An eye icon is the candidate; the
  session toolbar toggle would reuse it, in a toggled state. YA already uses
  an eye to show or hide content, for the thinking toggle and the
  commit-files pane (`CommitFilesPane`). So the glyph needs a distinguishing
  mark, such as an eye with an outgoing arrow or with the agent badge, and a
  tooltip that names the agent. It belongs in the shared
  window-action group (`ViewerWindowActions`) that app, artifact, file and
  panel viewers already carry, so it reads the same everywhere. Pressing it
  queues one notice describing that viewer, in the `ya-agent view` viewer
  shape, and nothing follows from later switches.
- **Session toolbar option.** A per-session toggle sends a notice for every
  viewer the user opens or switches to while it is on. Viewers the session
  opened itself are excluded, since the agent already knows about them.

Both are configurable and off by default
([vanilla defaults](../../topics/vanilla-defaults.md)). Neither starts a turn:
a notice rides on the next user turn, and repeated switches before that turn
collapse into the latest view. The composer should show that a notice is
pending, so the user can see and drop it before sending. Because the notice
travels as turn text, it reaches every provider, including launches with no
`ya-agent` grant or shell. That makes the gesture useful without the pull
read.

**Shrink the notice when the agent already pulls.** The service can observe
that a session reads its view: a `/v1/view` request under that session's
grant now, an MCP or dynamic-tool read later. Recording a last-read time per
grant costs no timer. When reads show the agent is attending to the view
channel, the notice can carry less:

- **Toolbar mode:** send nothing. The agent pulls when the user's words point
  at the view, and the per-switch push existed only for agents that would
  not.
- **One-time gesture:** keep a short pointer, such as "the user pointed at
  the open viewer; `ya-agent view` has it", in place of the full viewer
  record. The gesture says the user wants attention now, and a habit of past
  reads does not prove the agent will read before its next answer.

Without that evidence, or for a provider with no pull adapter, the notice
stays complete. This is a heuristic about cost. It never makes the pull read
a precondition for the gesture working.

**Out of scope here:** publishing YA's own viewers as `ui://` MCP App
resources so that ChatGPT or Codex Desktop could embed them. That direction
reverses the host and the server and has no current consumer.

Found 2026-10-06 while researching MCP Apps overlap with YA project apps.

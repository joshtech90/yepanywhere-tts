# MCP Apps sketches

> Candidate extensions of [MCP App hosting](mcp-apps.md) that are not
> implemented: other providers, automatic display, and the open questions the
> Codex slice left.

Topic: mcp-apps

## Other providers

Most of the host is provider-neutral: the proxy, the bridge, the display
modes and the timing of context delivery. Only two pieces are per-provider:
finding a tool call's view, and routing the view's own requests. Both enter
through `mcpAppRequest` on the provider session.

- **A side channel that serves any provider.** YA opens its own MCP client
  connection to the server named in the session's effective MCP config. Claude
  names tools `mcp__<server>__<tool>`, so the server is known from the tool
  name. YA lists that server's tools to find `_meta.ui.resourceUri`, reads the
  resource, and sends the view's tool calls over its own connection. The cost
  is a second connection: a stdio server is spawned twice, and a stateful
  server does not share state between the agent's connection and YA's. Prefer
  the provider's own channel where one exists, as with Codex. Use the side
  channel for stateless HTTP servers, or where the server declares that it
  tolerates a second client. Prove it on one stateless HTTP MCP App server
  first.
- **Claude.** Claude Code does not render MCP Apps itself; an open feature
  request asks for this in its Preview tool. Whether the Agent SDK message
  stream carries a tool descriptor's `_meta.ui` is unverified, so the side
  channel is the expected route. A held `ui/update-model-context` can ride on
  the next streamed user message.
- **ACP agents (Gemini, Grok).** YA passes `mcpServers: []` at session
  creation (`packages/server/src/sdk/providers/acp/client.ts`). Any server YA
  does pass is one YA already knows, so the side channel applies directly.
- **pi.** pi omits MCP by design ([pi provider](pi-provider.sketches.md)).
  Views can reach a pi session only through a user-installed pi extension
  that bridges MCP. Low priority.

## Open questions

- **Automatic display of fresh views.** Claude and ChatGPT render an inline
  view as soon as the call starts. YA could do the same for a call observed
  live in this tab, as the right pane does for fresh app announcements, while
  keeping replay click-to-show. It would also let `tool-input-partial` stream
  arguments into a view during the call.
- **Mode switches without reload.** Moving between the row and the panel
  remounts the view today. Keeping one frame alive across placements needs a
  host that can re-parent it, as the right pane keeps a minimized frame.
- **`pip` display mode.** It could map to the minimized viewer controller.
- **Declared permissions.** Honoring `camera`, `microphone`, `geolocation`
  and `clipboardWrite` needs an `allow` attribute on both frames and a
  per-view permissions policy on the proxy response, and an opaque-origin
  child complicates delegation.
- **Structured results on replay.** The rollout's `mcp_tool_call_end` event
  carries the full `CallToolResult`; replay could attach it so a reloaded view
  receives `structuredContent` rather than the model-visible text.
- **Sandboxed sessions.** Views are refused there today. Once the
  [sandbox MCP allowlist](../gaps/sketches/sandbox-mcp-allowlist.md) lets an
  operator admit a named server, its views could be served for that server
  alone.
- **Dedicated view origins.** `_meta.ui.domain` asks for a stable origin per
  view (OAuth callbacks, CORS allowlists). Every view now shares the artifact
  origin's proxy, with an opaque child origin.
- **Live-session coverage.** The browser spec mocks the session route; no
  test drives a live Codex app-server and MCP server through the card, route,
  proxy and bridge together.

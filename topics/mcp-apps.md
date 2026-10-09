# MCP Apps

> YA hosts MCP App views (extension `io.modelcontextprotocol/ui`, SEP-1865):
> when a tool's MCP server declares an interactive HTML view for a tool call,
> YA can show it beside or inside the transcript, framed on the isolated
> artifact origin and connected to the session through a brokered `ui/*`
> bridge.

Topic: mcp-apps

Status: implemented for Codex sessions behind a default-off server setting
(2026-10-06). Other providers, automatic display of fresh views, and the
remaining open questions are in [the sketches companion](mcp-apps.sketches.md).

See also:

- [active-content security](active-content-security.md) — why a view never
  runs on YA's API origin, and the artifact origin it runs on.
- [session right pane](session-right-pane.md) — where a fullscreen view is
  shown when the pane is enabled.
- [agent context injection](agent-context-injection.md) — the placement
  rules the held view context follows.
- [Codex user-turn provenance](codex-user-turn-provenance.md) — why the
  injected context is classified as provider context, not a user turn.
- [interactives](interactives.md#prior-art) — MCP Apps as prior art for a
  YA meta-UI channel; this host settles that evaluation by construction.
- [sandbox MCP allowlist sketch](../gaps/sketches/sandbox-mcp-allowlist.md)
  — how sandboxed sessions might later allow named MCP servers.

## Enablement

**Settings → Apps → MCP App views** is a server setting, `mcpAppViews`,
default off. It does two things, and both wait for it:

1. A Codex session whose app-server starts while the setting is on declares
   `io.modelcontextprotocol/ui` with `mimeTypes: ["text/html;profile=mcp-app"]`
   in its initialize capabilities. Codex forwards that declaration to every
   MCP server it connects (verified against codex-cli 0.160.1), so a server
   that offers UI tools only to capable hosts offers them. A session started
   while the setting was off keeps its app-server's original declaration and
   answers view requests with `unsupported` until it restarts.
2. Tool rows offer **Show app view**, and the session route serves view
   requests.

Views also need a configured artifact address for the reader's access path:
the local origin for a loopback page, the public origin otherwise
(`artifactOrigin`, the same choice interactive previews make). Without one the
row says so instead of offering the button.

## Which calls have a view

Codex records the view on its `mcpToolCall` item: `mcpAppUi` (`resourceUri`
and `preferredModelDisplayMode`) when the tool declares a display mode, and
otherwise only the legacy `mcpAppResourceUri`. YA accepts either, defaulting
to inline display. The live path puts it on the tool_use block as `_mcpApp`
(`McpAppToolCall`: server, tool, resource URI, display mode) and leaves the
tool input as the call's arguments. Replay reads the same fields from the
rollout's `mcp_tool_call_end` event and attaches them to the still-open
function call, so a reloaded transcript offers the same button.
`ToolCallItem.mcpApp` carries it to the row.

## Display

Nothing loads until the reader presses **Show app view**. Replayed history
therefore never re-runs a view, and a view whose session has stopped shows
its error in place of the frame while the row keeps its static result.

- **Inline** (the tool's preferred mode, or the default) frames the view in
  the tool row. Its height follows the view's `ui/notifications/size-changed`
  between 80 and 600 px.
- **Fullscreen** hands the view to the session's managed viewer as a panel:
  the right pane when Appearance → Session right pane is on, a covering modal
  otherwise. Minimize and close behave as for any panel.

While hosting is on, Conversation view treats a call with a view as
conversation content rather than routine activity, so a finished turn does
not fold its button into the hidden-activity summary. With the setting off,
such calls fold like any other tool call.

**Expand** and **Show in transcript** switch modes, and so does a view's
`ui/request-display-mode` for `inline` or `fullscreen`; any other mode
answers with the current one. Switching modes remounts the view, which loads
again and receives its input and result again.

## Isolation

The view runs in the double-frame arrangement the spec requires of web hosts:

- The YA page frames the **sandbox proxy**, a fixed YA-authored page served by
  the artifact handler at `/.yep/mcp-app-proxy`, with sandbox
  `allow-scripts allow-same-origin` on the artifact origin.
- The proxy frames the view's HTML as a `srcdoc` child with sandbox
  `allow-scripts allow-forms`, so the view has an opaque origin: no artifact
  origin storage, no reach into other artifacts, and no access to its parents.
- The proxy's response CSP is the view's policy, and a `srcdoc` document
  inherits it. It starts from the spec's restrictive default
  (`default-src 'none'`, inline script and style, `data:` images and media,
  `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`) and adds only
  the origins the resource's `_meta.ui.csp` declares. Declared entries that
  are not plain `scheme://host[:port]` origins are dropped, so a resource
  cannot inject a CSP keyword. The view cannot loosen the policy from inside.
- Declared `permissions` (camera, microphone, geolocation, clipboard) are not
  granted; the artifact origin's permissions policy denies them.

The proxy relays JSON-RPC only between its parent, checked by the origin
named in its `host` parameter, and its own child frame. It drops
`ui/notifications/sandbox-*` messages from the view. The YA page's bridge
reads only messages whose source is its proxy frame and whose origin is the
artifact origin, and posts only to that origin. Neither frame receives YA
credentials or API access.

## Bridge

`McpAppBridge` answers the view as an MCP Apps host:

| View → host | YA behavior |
|---|---|
| `ui/initialize` | Protocol `2026-01-26`; host context with theme, display mode, available modes (`inline`, `fullscreen`), platform, locale and time zone. |
| `tools/call` | Calls the tool on the **same server** through the session. |
| `resources/read` | Reads through the session, naming the originating call. |
| `ui/open-link` | Opens an `http`/`https` URL in a new tab without opener or referrer; other schemes are refused. |
| `ui/message` | Inserts the text into the composer draft, undoably. It is never sent on its own. |
| `ui/update-model-context` | Held latest-wins for this view and delivered before the next user turn (below). |
| `ui/request-display-mode` | See Display. |
| `ping` | Empty result. |

The host sends `ui/notifications/tool-input` with the call's arguments once the
view reports `initialized`, then `tool-result` when the call has finished, or
`tool-cancelled` when it was aborted or never completed. The result is the
provider's `CallToolResult` for a live call. A replayed call keeps only the
model-visible text, so its view receives that text as one content block.
Theme changes reach the view as `host-context-changed`. Unmounting a view
sends `ui/resource-teardown` and waits up to half a second for its answer.
Logging notifications have no host effect.

## Server contract

`POST /api/projects/:projectId/sessions/:sessionId/mcp-apps` takes one
`McpAppHostRequest` and answers through the session's live provider process
(`mcpAppRequest` on the provider session):

- `readResource {server, uri, originCallId?}` → `mcpServer/resource/read`.
- `callTool {server, tool, arguments?, approved?}` → `mcpServer/tool/call`,
  after `mcpServerStatus/list` confirms the tool exists and its
  `_meta.ui.visibility` includes `app` (absent visibility means both
  audiences). A tool not visible to apps is refused with 403
  `not-app-visible`, and an unknown tool with 404.
- `updateModelContext {key, server, tool, text}` holds or clears one slot.

Refusals are 409 with a `reason`: `disabled` (setting off),
`session-not-running`, `sandboxed` (an enforced session sandbox: the bridge
must not lend MCP servers back to a session whose sandbox withholds them),
and `unsupported` (no MCP App support in this session's provider). Provider
failures are 502 `provider-error`. Limited users are refused by the
limited-user route policy; their sessions are sandboxed in any case.

### Approval

A view-initiated call runs without asking when the tool's annotations mark it
`readOnlyHint` or the session is in `bypassPermissions` mode. Otherwise the
route answers `{approvalRequired: true, toolTitle}` and the view shows
**Allow once**, **Allow for this view**, and **Deny** above the frame. Deny
answers the view's call with an error. "Allow for this view" lasts until the
view unmounts.

### Held model context

Codex holds each view's latest context, keyed by its tool call, in the live
session. Immediately before the next `turn/start` it inserts every held slot
with `thread/inject_items` as a user-role message wrapped in
`<mcp_app_context server="…" tool="…">…</mcp_app_context>`, then clears them.
The context text is the update's text blocks followed by its
`structuredContent` as JSON, capped at 8,000 characters. A failed insertion
is logged and the slots stay held for the next turn. The wrapper is a marked
context fragment, so transcripts classify the injected item as hidden provider
context rather than a user prompt. Updates between turns cost nothing until a
turn uses them.

## Compatibility

`mcp-app-views` (permanent ID 120, version-implied from 0.9.4) owns the
setting field, the `_mcpApp` tool_use field, the session route and the proxy
path. The release review found none of them in v0.9.0–v0.9.2. Without the
capability the client hides the setting and every view button and makes no
view request. No existing capability changes meaning. The maintainer's
standing compatibility approval covers this gate.

## Verification

- `packages/server/test/routes/mcp-apps.test.ts` — refusals, visibility,
  approval, and request validation.
- `packages/server/test/artifacts/mcp-app-proxy.test.ts` — the served proxy's
  header policy and domain sanitizing.
- `packages/server/test/sdk/providers/codex.test.ts` — the initialize
  declaration and live `_mcpApp` normalization.
- `packages/server/test/sessions/normalization.test.ts` — replayed `_mcpApp`.
- `packages/client/src/lib/__tests__/mcpAppBridge.test.ts` — handshake order,
  origin checks, and request routing.
- `packages/client/e2e/mcp-app-view.spec.ts` — a real browser through the
  served proxy document and policy, with the session, settings, version and
  view route mocked: the view receives input and result in an opaque origin, a
  writing tool call waits for **Allow once**, a view message fills the draft
  and its model context reaches the route, composer typing stays within
  100 ms per keystroke while the view is live, and **Expand** moves the view
  to the panel. Desktop and phone captures are recorded.

On 2026-10-06 a throwaway probe drove codex-cli 0.160.1's app-server with a
stdio MCP server: the server received the declared extension in its client
capabilities, and status listing, resource read and an app-only tool call all
answered as this route expects. A Chromium harness ran the real proxy
document and bridge: the view initialized, received input and result, called a
tool, ran at origin `null` with storage blocked, could not reach its parent,
and had `connect-src 'none'` enforced. No test drives a live Codex session
through the route.

# Vhost app proxy refuses WebSocket upgrades

`proxyLoopbackVhost` (`packages/server/src/artifacts/vhost-proxy.ts`) answers
any `Upgrade` request with 501 after `VhostAccess.authorize` (401 before it),
so an app reached through `name.localhost` or `name.<public root>` gets plain
HTTP only. Streaming responses (SSE, chunked) pass through, so server-push is
available; only bidirectional sockets are not. The contract records this in
[active-content security](../topics/active-content-security.md#private-app-links).

What forwarding would buy, in order of weight:

- **Unmodified dev servers in the App pane.** Vite, Next, and similar dev
  servers use a WebSocket for hot module reload; through the proxy the page
  loads but HMR fails and the client retries the socket continuously. Today
  the agent must serve a built bundle or accept reload-by-hand. This is the
  main practical loss for the [project-templates](../topics/project-templates.md)
  `canvas` and `chat-turn-server` shapes during development.
- **Arbitrary third-party apps.** Any tool whose client opens a socket
  (terminals, live-collab editors, some notebook UIs) cannot be proxied at
  all, which narrows what a vhost row can point at.
- **Low-latency bidirectional apps.** Multiplayer or input-heavy games gain
  little from SSE plus POST per input; a socket is the ordinary transport.

What it does not buy: the shipped template shapes work without it. A
`chat-turn` server needs one request per user turn and one SSE stream back,
which the proxy already carries, so this is not a blocker for the proposal's
phases 1–3.

Cheap fix if taken: `createFrontendProxy` (`packages/server/src/frontend/proxy.ts`)
already relays raw upgrade sockets for the Vite dev client, so the forwarding
core exists. The work is authorization on the upgrade path — the app-scoped
bearer arrives as the `ya_app_access` cookie set by the first accepted URL,
and must be checked and stripped exactly as on HTTP — plus the same forwarded
headers, an idle bound on open sockets ([architecture mandates](../topics/architecture-mandates.md)),
and a test that an unauthorized upgrade still gets 401 rather than an open
socket. Relay-carried clients are unaffected either way: app bytes already
travel directly to the artifact origin, not through YA's relay.

Not fixed in place because the refusal is deliberate fail-closed behavior and
widening it is an [active-content security](../topics/active-content-security.md)
decision, not a template-side one.

Found 2026-09-19 while drafting the project-templates proposal.

# Auto-stop can misattribute a Claude Gateway session whose model id re-keys

`gatewayServiceUsage` attributes a live Claude Gateway session by looking its
launch model up in the route map the last catalog read built
(`ClaudeGatewayProvider.resolveServiceForModel` in
`packages/server/src/sdk/providers/claude-gateway.ts`). A model id only carries
its `<serviceId>::` prefix while two endpoints advertise it, so adding a second
endpoint that serves the same id re-keys the entry: a session launched under
the bare id is no longer in the map, and is counted against the default
service. That may not be the endpoint it is actually talking to, so the
endpoint serving it can reach zero live sessions and be auto-stopped mid-turn.

CodexOSS no longer has this defect: its sessions are bound to an endpoint at
launch and carry it as `ProcessInfo.gatewayServiceId`, which usage prefers
(topics/gateway-services.md § Catalogs and model identity). A catalog read that
fails, the commoner trigger named by the 2026-09 harsh review, already keeps a
Claude Gateway service's last good routes.

Not fixed alongside CodexOSS because a Claude Gateway launch resolves its
endpoint inside the provider-host worker after the worker's own catalog read,
not in the server process, so the server has no launch answer to record yet.
The cheap fix is the same shape: have `ClaudeGatewayProvider` implement
`resolveLaunchGatewayRoute`, pass the result to the worker as
`StartSessionOptions.gatewayRoute`, and make `launchContext` honor it, so the
worker launches against the route the server recorded; the reattach record and
`gatewayServiceUsage` then need no further change beyond dropping the
provider check.

Found 2026-09-18 while making auto-stop count CodexOSS sessions; narrowed to
Claude Gateway 2026-09-27 when CodexOSS sessions became launch-bound.
Contributing-model: opus-5
Contributing-model: opus-5.5

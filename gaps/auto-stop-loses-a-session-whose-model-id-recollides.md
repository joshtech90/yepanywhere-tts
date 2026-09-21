# Auto-stop loses a live session when its model id starts colliding

Both providers attribute a live session to an endpoint by looking its launch
model up in the route map their last catalog read built
(`packages/server/src/sdk/providers/codex-oss.ts:355` and
`claude-gateway.ts:440`). That map is rebuilt from scratch on every read, and a
model id only carries its `<serviceId>::` prefix while two endpoints advertise
it. So adding a second endpoint that serves the same model id re-keys the
entry: a session launched under the bare id is no longer in the map.

`gatewayServiceUsage` then counts that session nowhere for CodexOSS, or against
the default endpoint for Claude Gateway — which may not be the endpoint it is
actually talking to. Either way the endpoint serving it can reach zero live
sessions and be auto-stopped mid-turn: the same failure as an unattributed
provider, reached by a rarer route.

Not fixed alongside that provider fix because it wants a different mechanism:
attribution should not depend on a map a later catalog read can re-key. The
cheap version is to record the resolved service id on the process at launch —
the launch already computes it — leaving the route map as the fallback rather
than the source.

Found 2026-09-18 while making auto-stop count CodexOSS sessions.
Contributing-model: opus-5

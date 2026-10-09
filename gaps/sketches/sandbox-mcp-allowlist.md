# Sandboxed sessions cannot use any operator-chosen MCP server

Every sandboxed Claude-family launch disables all configured MCP servers and
Claude.ai connectors
([session sandboxing § Claude MCP and connectors](../../topics/session-sandboxing.md#claude-mcp-and-connectors)).
The only planned exception is YA's own read-only view server
([agent-visible session view](agent-visible-session-view.md)). An operator who
trusts a specific server, such as a docs search or a local read-only tool, has
no way to allow it in a sandbox. A limited user's sessions are always
sandboxed, so for them the restriction is total.

Candidate shape, undecided:

- **Granularity.** An allowlist of named servers per sandbox level, with an
  optional per-limited-user override that can only narrow it. Default empty,
  so current behavior holds until an operator opts in.
- **What an entry means.** A server name, plus how far it may reach:
  in-process or stdio only, or remote URLs too. The remote-server deny rule
  stays unless an entry names a URL explicitly. Claude.ai connectors stay off
  unless a separate switch enables them.
- **Enforcement.** The allowlist feeds the same launch options that now
  empty the server map: `mcpServers`, `allowedMcpServers`, `strictMcpConfig`
  and the `mcp__<name>__*` tool rules. Codex and ACP launches get the
  equivalent configuration. A server missing from the provider's
  configuration is reported, not silently dropped.
- **UI.** Sandbox settings list the servers each provider has configured,
  with a toggle per server per level, and Settings → Users carries a
  per-user narrowing. Changes apply at the next launch, as other sandbox
  settings do.

**Decided (user-directed 2026-10-06):**

- **YA builds the list.** YA reads each provider's MCP configuration (Claude
  settings and `.mcp.json`, Codex `config.toml`, ACP agent config) and lists
  the servers it finds. The operator only toggles them and does not type in
  names. A server that disappears from the config shows as missing instead of
  being silently dropped.
- **Servers run inside the sandbox where possible.** A stdio server is a
  subprocess the sandboxed provider spawns, so it already starts inside
  Bubblewrap with the session's filesystem and network limits, and talks to
  the provider over pipes. Allowing one adds no authority beyond what the
  sandbox grants.

**The catch is connectivity.** Pipes cover provider ↔ server, but many servers
also need something outside the sandbox:

- **Public remote services:** reachable through the firewall's normal egress.
- **Host-local services** (a local database, YA itself, a loopback API):
  blocked. The firewall denies loopback and private ranges, for the same
  reason it blocks host-local gateways
  ([network boundary](../../topics/session-sandbox-network-boundary.md)).
- **YA's own view server:** for Claude it needs no connection, since the
  in-process server runs in YA's process and is reached over the SDK control
  channel. For Codex and ACP it would be a stdio shim inside the sandbox, and
  the shim needs a path back to YA.

That path would be the outbound counterpart of the inbound port broker: a
per-launch Unix socket that YA serves and bind-mounts into the sandbox's
private `/run`, the way the agentctl bridge is mounted. It is bound to that
session's grant and answers only YA's own read-only routes. It would also let
`ya-agent view` and `ya-agent self` work in sandboxes, which today receive no
grant. An allowed third-party server that needs a host-local service has no
such path. It works only with the firewall off, and the sandbox settings
should say so beside its toggle, not let it fail at runtime.

Still open: whether YA should offer a per-server socket relay to a named host
service. That would be a narrow hole like the inbound broker, but every relay
widens what the sandbox can reach.

Found 2026-10-06 while deciding that YA's view server alone passes the
sandbox MCP lockdown.

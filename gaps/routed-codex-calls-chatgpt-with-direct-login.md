# Routed Codex sessions call ChatGPT's backend with the direct login

A routed Codex session runs `codex app-server` with the owner's normal
`CODEX_HOME`, so the ChatGPT login in `auth.json` is present; YA only points
model traffic at the Agent Auth Router (`codexRouterArguments` and
`codexRouterEnvironment` in `packages/server/src/sdk/providers/router-transport.ts`).
Every app-server start, including a routed thread start or `thread/fork`,
then contacts `chatgpt.com` authenticated as that direct account:
`backend-api/plugins/featured`, `ps/plugins/installed`, `ps/plugins/list`,
`ps/plugins/suggested/codex`, `ps/mcp` and `codex/analytics-events/events`.
None are model requests, so no model quota is spent, but the direct account
is identified to OpenAI, which `topics/agent-auth-router.md` rules out
("never use direct credentials").

Observed 2026-10-11 with Codex CLI 0.160.0 (YA pins 0.162.1) through a logging
proxy that refused every connection, with and without YA's exact router `-c`
flags; the fork itself succeeds with all network refused.

Not fixed in place because it is independent of the clone work that found it.
Likely fix: for routed launches, disable plugin and connector discovery and
analytics through `-c` overrides, after confirming the config keys in the
pinned Codex source, or run routed processes without the ChatGPT login
(`requires_openai_auth=false` already holds for the router provider).

Found 2026-10-11 while checking whether a routed Codex fork needs router
credentials.

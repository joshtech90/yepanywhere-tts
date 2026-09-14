# Agent Own-Session Inspection

> `ya-agent self` reports the owning YA session's launch settings, current
> selections, and observed provider evidence through a read-only local service.

Topic: ya-agent-self

Verified: 2026-09-08. Opt-in implementation; broader command tooling remains
in [the runtime proposal](agent-command-runtime.sketches.md).

## Enable and discover

Start YA with `YEP_AGENT_SELF=1` (or `true`) and launch or resume a provider
process. Default is off. The environment must reach the actual YA server;
for the desktop app, set it in the environment used to launch the application.
Changing it does not update an already-running provider process.

Supported launches are local Claude, Claude Gateway, Claude Ollama, and Codex
with `bypassPermissions`. Remote executors, YA session sandboxes, and other
Codex permission modes receive no grant. Inspection does not widen filesystem
or network permissions. A provider's independently configured sandbox may
still prevent it from reaching loopback.

YA creates a private temporary command directory and adds it to the child
PATH. The command is bundled with the owning server version: source checkouts
use their source entry and local TS loader; npm uses installed compiled files;
desktop uses compiled files and its absolute private Bun executable. No global
`ya-agent` installation is needed. The Windows launcher is `ya-agent.cmd`
for native command-shell use; macOS/Linux use an executable shell wrapper.
Windows Git Bash discovery of `.cmd` is not part of this initial contract.

Run `ya-agent self` for human output or `ya-agent self --json` for a versioned
report. There is no automatic prompt advertisement or New Session UI yet.
Operators can put this instruction in **both** `~/.codex/AGENTS.md` and
`~/.claude/CLAUDE.md`, or their managed source files:

> When asked which model, effort, or YA session you use, check whether
> `ya-agent` is on PATH and run `ya-agent self --json`. Distinguish launch
> settings, selected settings, provider evidence, and pending changes. Report
> unknowns explicitly. The result identifies the owning YA session; an
> inherited child-agent environment does not prove the child's own model.
> If unavailable, say so rather than guessing from your prompt or aliases.

YA does not edit those instruction files. graehl/agents and `agentctl` remain
independent consumers of session facts; no installation or change there is
required for this command.

## Evidence contract

Schema version 1 includes canonical `sessionId`, per-launch `launchId`,
`launcher`, `harness`, `provider`, `observedAt`, and these distinct fields:

| Field | Meaning |
| --- | --- |
| `launch.model`, `launch.effort` | Original explicit request, or `status: "default"` with null value. |
| `selected.model`, `selected.effort` | YA's selection, including an effort change waiting for a provider boundary. |
| `providerEvidence.model` | Latest observed init, configuration acknowledgement, assistant response model, or accepted adapter control. |
| `providerEvidence.effort` | Observed configuration acknowledgement or accepted adapter control; otherwise unknown. |
| `pending.effort` | Whether the supervisor still has an effort change awaiting successful application. |
| `activeInference` | Always `"unknown"`; session settings do not attest to every in-flight inference request. |

Each model/effort value has `value`, `status` (`known`, `default`, `unknown`),
`source`, `scope` (`launch`, `session`, `response`), and its own observation
timestamp. `adapter-control` means the adapter returned successfully, not
provider confirmation of a specific inference. An assistant model observation
describes that response. Alias strings are preserved; downstream gateway model
revisions and backend identities are not inferred. Native child agents can
inherit the owning session's capability while using different settings.

The projection lives beside the provider adapter. The supervisor publishes
pending effort through an optional provider-host capability/RPC. On retained
worker paths, the service and observations outlive Hono controller detach and
reattach. The process REST API remains separate and retains its existing
semantics. No provider settings or durable session data are written by reads.

## Connection, lifetime, and failures

The owner injects `AGENT_YA_API_URL` and `AGENT_YA_API_TOKEN`. The only route is
`GET /v1/self`, authenticated by the bearer token. The token selects its own
session; callers cannot choose a target. `AGENTCTL_SESSION_ID`, when available,
is sent as `X-Agent-Session-Id` and checked against the bound canonical id.
Token-only lookup supports shells without the late Bash session-id bridge.
Before binding, the service returns `session-not-ready`.

One ephemeral listener/bin is shared within each provider-owner process.
Grants expire after 24 hours and are revoked when the provider iterator ends
or is aborted. Resume a provider process to obtain a new grant. Last-lease
teardown closes the listener and removes the directory. There is no idle poller
or liveness extension. Ambient self credentials are stripped before a new
provider launch receives its own grant. Tokens are not placed in arguments,
reports, or logs; like other environment capabilities, they are readable by
code executing inside the provider's trust boundary.

The CLI accepts only the injected IPv4 loopback HTTP origin, makes one request
with a five-second total deadline and 64 KiB response limit, and never searches
for a different server. JSON failures are
`{"schemaVersion":1,"error":{"code":"..."}}` on stdout. Human failures go to
stderr. Exit codes are:

| Exit | Codes |
| --- | --- |
| 0 | Successful report |
| 2 | `usage` |
| 3 | `unavailable` (missing or invalid launch context) |
| 4 | `unauthorized`, `expired`, `session-mismatch` |
| 5 | `session-not-ready`, `owner-unavailable` |
| 6 | `unsupported-protocol`, `invalid-response` |

Unsupported launches normally have no command on PATH. A leftover inherited
launcher without credentials cannot acquire a new grant or call operator APIs.

## Validation owners

- `packages/server/test/agent-tools/`: actual CLI/service subprocess tests,
  scripted Claude SDK shell execution, supervisor boundary application, and
  retained-owner reattachment/remapping. No cloud LLM is required.
- `packages/server/test/sdk/providers/codex.test.ts`: fake app-server launches
  a real Bash tool through the production Codex adapter.
- `scripts/agent-self-smoke.mjs`: source or artifact-only imports plus real
  shell execution with global runtime discovery removed from PATH.
- `scripts/agent-self-package-smoke.mjs`: packs and installs the npm artifact
  into an isolated temporary directory before probing it (Linux CI).
- CI runs source tests on Linux/macOS/Windows and an installed npm artifact
  probe. Desktop CI runs the probe with bundled Bun through the existing
  resource smoke gate, including signed macOS application checks.

These tests prove deterministic transport, delivery, provenance, and lifecycle
behavior. They do not claim an unmocked cloud model followed the instruction
or that a provider reported an exact hidden backend revision.

Related: [tactical](../docs/tactical/122-ya-agent-self-inspection.md),
[environment boundaries](subprocess-environment.md),
[provider host](provider-host-api.md), [desktop](desktop-v0.md).

# Provider host API sketches

> Candidate headless provider-host authority mechanisms that are not part of
> the current provider host API contract.

Topic: provider-host-api

## Provider-issued capability instructions

A separately started provider host is useful without Hono or the YA web UI. A
future provider-only primitive could let one authorized, provider-host-launched
agent hand another agent a short instruction that grants a narrow operation on
one live provider worker or another host-owned resource.

The provider host should mediate this facility directly. It should not become
a generally exposed plugin primitive, depend on a browser tab, or require a YA
UI process. The existing owner-only host socket and token remain the local
admission boundary.

One possible design is:

1. At start, the provider host creates an ephemeral signing key and a random
   caller credential. Rotation may use a one-hour signing window with a short
   overlap for already issued grants.
2. An admitted same-user caller asks the host to mint a signed capability
   envelope naming the host boot, provider worker generation, audience,
   operation scopes, issue/expiry times, and a random grant id.
3. The copied artifact is an agent instruction plus the opaque envelope. A
   provider session launched by that host already has the address and caller
   factor needed to redeem it.
4. Redemption returns to the host, which verifies both factors, current worker
   identity, expiry, revocation, and operation scope before invoking the
   existing typed host protocol.

The host keeps the signing private key. Injecting that key into every session
would turn any leak into grant-minting authority and is unnecessary when the
host remains the mediator. A verifier key may be public, but possession of it
does not replace the injected caller factor.

Candidate scopes should reuse typed operations such as bounded event
observation, one auxiliary turn, status inspection, or interruption. Full
provider control must be an explicit scope. Envelopes are bearer material:
short expiry and an in-memory revocation set bound exposure, while process and
server restart invalidate the boot identity. Ordinary logs and persisted host
descriptors must never contain raw caller credentials or envelopes.

This sketch is deliberately separate from
[`remote-browser-diagnostics.md`](remote-browser-diagnostics.md). The browser
feature needs Hono to rendezvous with an opted-in tab and therefore uses a
simple caller factor plus a per-tab grant. When a reload-safe host is present,
that factor is domain-separated from its boot token so Hono replacement does
not strand retained agents. The provider-only design is for UI-less consumers
of the separately startable provider host and can be specified when a concrete
headless operation needs delegation.

## Sandbox-scoped provider access

Today a [project-write sandboxed session](session-sandboxing.md) has no
provider-host access at all: the runtime directory is masked, the token
variables are unset, and the network firewall isolates host sockets. An
unsandboxed same-user process has full access through the token file. A
sandboxed session that wants helper turns (batch annotation through
`session-turn`, for example) needs something between those. Either of the
following would do; the maintainer considers both acceptable (2026-09-28).

### Per-session restricted endpoint

The host opens a separate socket per sandboxed session and YA bind-mounts only
that socket into the sandbox. Holding the endpoint is the capability. Every
descendant inherits it, and nothing inside the sandbox can remove it or reach
the unrestricted control socket.

- On accept, the host confirms the caller from kernel credentials:
  `SO_PEERPIDFD` (or `SO_PEERCRED` with a pid-reuse check), then the caller's
  user and network namespace identities match the ones YA recorded for that
  session. A copied endpoint therefore cannot be replayed from elsewhere.
- The endpoint carries a policy fixed when the session was created, for
  example: helper turns only in the same project, always launched with the
  same sandbox and firewall, and a filtered permission set.
- A session launched through a restricted endpoint receives its own endpoint
  whose policy is no broader than its parent's, so authority only narrows
  down the process tree.
- The endpoint's lifetime is the session's. Revocation is closing the socket.

### Signed capability for every caller

Admission requires a host-signed capability in the style of
[provider-issued capability instructions](#provider-issued-capability-instructions)
for every operation, including callers holding the host token. Sandboxed
sessions receive a narrow grant; ordinary sessions a broader one. This gives
finer scopes than all-or-nothing, but an unsandboxed same-user process can read
another process's environment and files. Only the sandbox makes a narrow grant
non-removable, so this layer adds scoping, not a boundary, for unsandboxed
callers.

### Access mode setting

A "YA only" mode that stops publishing the token file would remove the
`session-turn` host path (it falls back to a native provider resume) without
stopping a determined same-user process: `/proc/<pid>/environ` of the server,
which receives the token by environment, is readable by the same user even
with Yama `ptrace_scope=1`. Sandboxed sessions are already excluded in either
mode, and both reload paths keep working because the dev wrapper holds the
connection. Defer the setting until one of the designs above needs a
distinct default.

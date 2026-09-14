# Agent Command Runtime

> Proposal: YA ships one version-locked command runtime, projects only enabled
> commands into eligible supervised sessions, and lets those commands adapt
> scoped service APIs without installing another global CLI.

Topic: agent-command-runtime

Status: broader direction proposal, updated 2026-09-08. The first milestone,
read-only `ya-agent self`, is implemented as an opt-in feature; its authoritative
contract is [Agent Own-Session Inspection](agent-self.md). The details below
remain design context where they go beyond that contract.
Private input, broader session access, yacron integration, and
automatic command advertisement are deferred beyond that milestone.

Related:
[new-session agent tooling](new-session-agent-tooling.md),
[agent session access](agent-session-access.md),
[agent context injection](agent-context-injection.md),
[yacron](yacron.md),
[subprocess environment boundaries](subprocess-environment.md),
[desktop v0](desktop-v0.md),
[session sandboxing](session-sandboxing.md),
[attachment storage](attachment-storage.md),
[security](security.md), and
[vanilla defaults](vanilla-defaults.md).

## Decision summary

- Start with `ya-agent self` and `ya-agent self --json`. Ship only the command
  and connection machinery needed to inspect the caller's owning session.
  Initial instruction discovery is operator-managed through harness-global
  instruction files; YA-generated capability fragments and their UI are later
  work. This ordering is local to this proposal, not a change to the product
  roadmap's publishing priority.
- YA ships one internal `ya-agent` command implementation with its server
  artifacts. It is not a second user-installed product CLI.
- One active YA provider-runtime owner creates one private, temporary command
  directory. It does not create a copy of the implementation for every
  session.
- The later per-session UI stores requested agent-command capabilities. A
  global new-session default may seed that choice, but it does not grant
  commands to an existing session or replace the explicit session value.
- On every provider-process launch, YA intersects the session request with the
  provider, executor, sandbox, and server capabilities that can actually
  deliver it. Only a launch with at least one effective grant receives the
  command directory, endpoint, and credential. Automatic matching instructions
  are deferred for the self-inspection milestone.
- Each launched session receives separate, short-lived API authority; the
  shared launcher itself contains no credential or session identity. YA
  authenticates that authority with an unguessable capability, not by walking
  or trusting a caller-supplied process tree.
- Each feature keeps one authoritative service API. `ya-agent`, a product-
  specific alias such as `yacron`, the YA UI, and a later MCP adapter are
  clients of that API, never parallel implementations of its policy.
- When automatic advertisement is added, command availability and its fragment
  derive from the same effective grant. Requesting one feature grants only
  that feature's command scope and contributes only its exact, previewable
  `[Client capabilities]` fragment.
- The deferred per-session **Allow private input requests** option is durable,
  default-off, and takes effect when YA next launches an eligible provider
  process. There is no ambient secure-input authority on a vanilla launch.

## First milestone: inspect the owning session

`ya-agent self` answers which YA session owns the command and what YA can
verify about its model and effort. Default output is a compact human-readable
report; `--json` returns a versioned machine-readable object. The operation is
read-only: it does not submit a turn, resume or launch a provider, change model
settings, register an agentctl entry, or claim a worker.

The command uses the launch-provided connection and capability, with
`AGENTCTL_SESSION_ID` as the canonical session-id cross-check. The server binds
the request to its credential's session and launch generation; the command
does not accept an arbitrary target session. Return these separate facts:

| Fact | Meaning |
|---|---|
| Ownership | Canonical YA session id, owning runtime/launch generation, harness, provider route, and explicitly known backend. |
| Launch settings | Original requested model and effort, matching the `AGENT_LAUNCH_*` history. |
| Selected settings | YA's current configured model and effort, including provider-default selections. |
| Provider evidence | Provider-reported model id and provider-accepted effort, each with its source and observation time or turn id when available. |
| Pending changes | Selections awaiting application and whether they target the active turn or a subsequent turn. |

Unknown, provider default, and pending are distinct states. A successful owned
session lookup can contain unknown model or effort fields; it must not invent
an exact value to make the report complete. Keep requested aliases separate
from provider-reported ids, and do not claim a gateway's ultimate model
revision unless the backend supplies that evidence. Provider acceptance of a
setting is not proof that every in-flight request already uses it. Include
the observation scope so an earlier turn or a next-turn setting cannot be
presented as the exact model generating the current response.

The credential identifies the supervised session/process tree. A provider-native
child agent may inherit it while using another model or effort. `self` must
label the result as the owning YA session's state, not attest to the calling
child model's identity without a separate provider-backed child mapping.

### Existing evidence and missing API contract

As checked on 2026-09-08, `GET /api/sessions/:sessionId/process` returns
`Process.getInfo()` or `{ "process": null }`. Its `model` uses `resolvedModel`,
which can fall back to the launch model; `requestedModel` retains the requested
selection. Its `effort` getter includes queued next-turn choices, while
`appliedEffort` exists internally but is not exposed in that response. See
`packages/server/src/routes/sessions.ts`,
`packages/server/src/supervisor/Process.ts`, and
[provider runtime status](provider-runtime-status.md).

The first milestone needs a narrow, versioned self-inspection service
projection from the live owner, with explicit evidence and pending/applied
semantics. Wrapping the existing process response and labeling every field
"current" is insufficient. Reuse the session/provider state owners; do not
create a second model-settings store. The existing Linux provider-host
discovery protocol is useful infrastructure, but it is not a portable
per-session self-inspection capability or a complete current-settings response.

### Initial availability and manual instructions

Defer automatic `[Client capabilities]` injection, Settings previews, onboarding,
and per-session command-advertisement UI. An operator can initially advertise
the command in Codex's user-global `~/.codex/AGENTS.md` and Claude Code's
user-global `~/.claude/CLAUDE.md` (or their managed source files). A generic
home-directory `AGENTS.md` is not the shared entry point for both harnesses.
YA does not edit these files or install the graehl/agents corpus.

Suggested operator-managed instruction, to install once the command ships:

> When asked about your model, effort, or YA session ownership, check whether
> `ya-agent` is available and run `ya-agent self --json`. Report the owning
> session, evidence source, and any pending or unknown values. Do not equate
> launch or selected settings with verified active-turn settings, or the owning
> session with a differently configured child agent. If unavailable, say so;
> present any `AGENT_LAUNCH_*` values only as launch history. Query again for a
> later current-settings question rather than reusing an earlier observation.

Manual instructions replace only advertisement. The first milestone still
needs an explicitly enabled, default-off self-inspection grant, a discoverable
command path, and a launch-bound connection to the correct YA instance. An
operator-configured opt-in can precede a New Session UI; its exact configuration
name and lifecycle must be settled before implementation. Keep the proposed
`AGENT_YA_API_URL` / `AGENT_YA_API_TOKEN` channel from
[new-session agent tooling](new-session-agent-tooling.md), restricted initially
to reading the owning session. Do not guess ports/profiles, use a wake token
for another API, or fall back to provider-native resume. Instruction text and
the presence of an executable confer no service authority.

The command makes one bounded lookup without ongoing polling. Specify stable
exit codes and JSON error categories for unavailable launch context, refused
or expired authority, unreachable owner, unsupported protocol, and an owner
that no longer has that live session. None implies that no historical session
exists. A stale retained setting must never masquerade as a fresh live reply.
Local Claude and Codex are the initial provider targets; test macOS, Linux,
and Windows, and explicitly reject unsupported sandbox/remote placements.

## One implementation, one runtime command directory

The immutable JavaScript implementation lives in the built server artifact,
for example `dist/agent-tools/cli.js`. The npm distribution includes it under
the existing `dist` payload. The desktop distribution includes the same file
under its bundled server resource, so a desktop update replaces the native
shell, private Bun runtime, server, client, and agent command implementation as
one tested release unit.

Before the first enabled launch needs it, YA creates one random private
directory beneath the platform temporary root, conceptually:

```text
<os-temp>/ya-agent-tools-<random>/
  bin/
    ya-agent       # executable wrapper on macOS/Linux
    ya-agent.cmd   # command wrapper on Windows
    yacron          # optional product alias when that capability is enabled
```

The wrappers contain absolute paths to the current server runtime and bundled
implementation. An npm launch therefore uses the Node executable already
running YA. Desktop uses its private bundled Bun executable without adding Bun,
YA, or the wrapper directory to the user's global `PATH`. The wrapper is a
small dispatch adapter, not another compiled or separately signed sidecar.

The directory is owner-private and contains no bearer token or private input.
YA removes it on orderly runtime-owner shutdown and performs bounded stale-
directory cleanup after an unclean exit. Project directories and Git metadata
are never used for launchers, credentials, or private-input files.

This command directory is shared by sessions belonging to that runtime owner.
The capability is still per session because only a provider child with an
effective grant receives the `PATH` prefix and every launched session receives
independent scoped authority. Prepend with the platform path delimiter rather
than append, so an ambient executable with the same name cannot win command
resolution.

The runtime owner follows provider ownership. When Hono owns the provider
process, it also owns the directory and session capability. When the shared
provider host keeps a worker alive across a Safe Reload, the host/worker side
must retain or reconstruct the command projection and its stable scoped bridge;
a replaceable Hono process must not strand a live provider with dead PATH or
token state. Desktop's bundled server remains the ordinary local owner.

## Per-session request and effective launch grant

The per-session UI below is deferred beyond self-inspection's initial
operator-configured opt-in. Agent-command access is durable requested session
state, like executor and sandbox selection. The New Session form owns the
explicit choice. A saved
new-session default may initialize that form, remains default-off, and is no
more authoritative than YA's other new-session defaults: changing it does not
rewrite existing sessions.

At provider launch, YA derives:

```text
requested session capabilities
  intersected with launch eligibility
= effective launch capabilities
```

The initial private-input eligibility boundary is deliberately narrow:

| Provider placement | Initial private-input grant |
|---|---|
| Local, YA-launched, shell-capable, unsandboxed process | eligible |
| Provider without usable shell execution | ineligible |
| Project-write or network-restricted sandbox without a narrow YA bridge | ineligible; do not widen it |
| SSH or managed remote executor | ineligible until helper and file placement are location-correct |
| Externally discovered process YA did not launch | ineligible |

An ineligible launch receives no command `PATH`, endpoint credential, or
instruction fragment. The UI keeps the requested choice visible and explains
why it is not effective instead of silently changing it.

Resuming the same canonical YA session retains its requested capabilities but
reevaluates launch eligibility and receives a fresh launch credential. A fork,
side session, scheduled session, or other newly created YA session does not
inherit the source session's authority unless its own launch request explicitly
selects it. Provider-native nested agents and shell descendants may inherit the
parent provider process's environment; the enforceable first boundary is the
supervised session/process tree, not each nested model agent.

Enabling a capability takes effect on the next provider-process launch or
resume. Disabling it revokes the current server-side credential immediately,
but a running provider can retain stale `PATH` and already-injected context
until it restarts; the UI must report that distinction instead of claiming the
old process forgot the command.

## Launch projection and authority

For each provider launch with an effective grant, the provider-owned launch
step supplies:

- the command directory at the front of the child `PATH`;
- the exact child-reachable YA service URL; and
- an ephemeral token scoped to the effective commands and originating provider
  process/session launch generation.

The token is an internal capability, not the operator's browser cookie,
desktop bootstrap secret, remote-access credential, or provider-host control
token. The server stores its binding to the session, launch generation, exact
command scopes, and expiry; a request cannot select a different session or
widen those scopes with arguments. The binding may begin with a provisional
process identity and follow YA's canonical session-id remap; commands and UI
continue to report canonical YA session ids. The token and URL travel through
the restricted child environment and never appear in the agent-context
fragment, command arguments, or ordinary logs.

The API does not ask `ya-agent` to report its PID and does not infer authority
by walking process parents. A self-reported PID is spoofable; an HTTP listener
does not portably receive a peer PID; ancestry changes across provider workers,
shells, reparenting, Windows, and remote execution. A future local Unix-socket
transport may use peer credentials as defense in depth, but the portable
authorization boundary remains the launch-injected capability and its
server-side scope.

Filesystem presence is not authorization. A shared directory may contain a
dispatcher or product alias whose operation is not granted to every session;
help output and every service call derive availability from the caller's token
scopes and fail closed for other commands.

The direct provider environment is the preferred launch channel. Claude's
non-interactive Bash path may reuse the existing chained `BASH_ENV` bridge for
values that become known after provider spawn. This generalizes the mechanism
already used for `AGENTCTL_SESSION_ID` and session wake/browser-debug outputs;
it does not make `agentctl` a dependency.

The bearer capability is accessible to the authorized provider process tree by
design. It is not a hard isolation boundary against another unsandboxed process
running as the same OS user, which may already possess comparable local access.
Its value is least privilege, revocation, unambiguous server/session selection,
and avoiding ambient distribution of the supported command channel. Stronger
sandbox isolation requires a narrow broker that the sandbox can reach without
gaining general YA or network access.

Every new agent-command route requires its launch capability even on an auth-
disabled loopback server. This protects private input and makes the supported
command interface narrow, but the session option does not revoke authority an
ordinary unsandboxed same-user process already has outside that interface. In
YA's default localhost trust model, such a process may discover and call
existing unauthenticated `/api/*` routes directly. A hard "cannot control YA"
boundary therefore requires an enforced sandbox with authenticated localhost
and no general listener access, or a separate least-privilege OS execution
boundary. Changing the existing loopback trust model is separate scope.

## Command and API layering

`ya-agent` is a multi-command transport adapter. Candidate consumers include:

```text
ya-agent self [--json]
ya-agent private-input --prompt <text> [--timeout <duration>]
ya-agent sessions ...
ya-agent transcript ...
ya-agent search ...
ya-agent send ...
ya-agent new ...
```

Only `self` belongs to the first milestone. All other commands listed remain
deferred designs and do not expand its read-only capability.

The exact session-access subcommands remain owned by
[agent session access](agent-session-access.md). A stable product command may
keep its own name. In particular, the already-reviewed yacron interface remains
`yacron schedule|list|show|...`; an integrated YA installation may implement
that launcher as an alias into the shared runtime. Standalone yacron still
ships a normally installed CLI because it must work when no YA server or
supervised session exists.

Every command calls a versioned service API and returns stable exit codes plus
machine-readable output where its owning feature requires it. No command owns
a second scheduler, session catalog, authorization policy, or durable store.
An MCP server can later expose the same operations for providers with a
reliable custom-tool channel, but it remains another adapter rather than the
first provider-neutral delivery mechanism.

## Deferred: private agent input

Private input is an accidental-context-disclosure guard for PINs, short-lived
tokens, passphrases, and similar values. It is not a hostile-agent isolation
boundary and should not be presented as a vault for high-value long-lived
credentials.

The agent invokes:

```bash
secret_file="$(ya-agent private-input \
  --prompt 'Enter the deployment PIN' \
  --timeout 10m)"
deployment-command --pin-file "$secret_file"
```

The command flow is:

1. The helper creates a request through its scoped service API. Creation
   returns a request id immediately; the command then waits for resolution.
2. YA publishes a pending private-input event to authenticated owner clients
   viewing or monitoring that session. The UI shows a password-style dialog
   with the requesting session, prompt, expiry, Cancel, and Submit.
3. The browser sends the value over its existing authenticated transport. A
   relay-mediated connection retains its existing end-to-end encryption; the
   relay receives no new plaintext surface.
4. The service delivers the value once to the waiting helper. The helper
   writes it on the provider execution host to a random owner-only temporary
   file and clears its in-memory buffer as soon as practical.
5. Standard output contains only the resulting execution-host file path. The
   secret bytes never become tool output, transcript text, provider input,
   attachment metadata, a public-share resource, or an approval-audit field.
6. Cancel, helper disconnect, provider termination, or timeout resolves the
   request without a file and produces a documented nonzero exit status.

The agent capability authorizes only request creation, waiting, and
cancellation for its bound session. Submission uses the authenticated operator
client plane; an agent token cannot answer its own request or call general
operator routes. A launch revocation also terminates its unresolved requests.

This is a distinct private-input request family, not an ordinary provider
question or tool approval. It must not reuse a generic response path that
serializes answers into provider input or the approval audit. The browser keeps
the draft only in component memory, requests password-manager suppression,
clears it on submit/cancel/unmount, and never saves it as a composer or
question draft. If several authenticated owner clients display the request,
the first valid submission wins and the others receive its terminal state.

The service does not persist the value. It retains only the bounded in-memory
handoff needed to deliver a submission to the waiting helper; if that helper is
gone, the submission fails closed instead of becoming a later-retrievable
secret. Request metadata and terminal state may be logged or retained, but the
value, its length beyond a coarse bounded class, and the materialized path are
redacted.

YA's current Codex `isSecret` question presentation is only a partial visual
precedent: it masks the input and avoids browser draft storage, but its answer
still returns to the provider and can enter the approval audit. Private input
may reuse the password-field interaction, not that response or audit path.

The API need not hold one HTTP request open for the entire user wait. A create
operation plus bounded await/status operation permits reconnect and explicit
cancellation while the shell command remains blocking from the agent's point
of view. A proposed first limit is a ten-minute default wait with a thirty-
minute maximum; final values require implementation-time UX validation.

Private-input files use a distinct execution-host runtime directory, not YA's
uploads directory and not the selected project. The execution-host owner
removes them at the earlier of provider-process teardown or a bounded
post-delivery expiry. One host-level next-deadline cleanup owner may cover all
files; the feature must not add a permanent polling loop per session. A future
`--exec` form could delete immediately after a child command exits, but it is
not required for the path-returning first version.

Returning a file path reduces accidental disclosure; it cannot prevent an
agent with filesystem and command authority from reading the file, nor can YA
prevent the receiving program from echoing the value. The capability fragment
therefore tells the agent to pass the path through without reading, displaying,
copying, or embedding the contents in arguments. Commands that accept secrets
only as literal command-line arguments remain poor consumers because process
listings and shell history introduce separate disclosure paths.

### Location-correct remote execution

The file must exist on the machine where the provider's command runs. A local
npm or desktop provider can use the local execution-host runtime directly. An
SSH or managed remote executor must materialize both the helper and its private
file on the remote execution host and use a controller-approved return channel;
returning a local server path to a remote agent is invalid.

Initial support may explicitly exclude an executor until its runner can prove
that placement, transport, permission, and cleanup contract. Unsupported
launches omit the fragment and command scope rather than exposing a command
that will return an unusable path.

## Deferred: session control and exact agent context

The private-input control belongs in the New Session form's **Agent access** area:

**Allow private input requests** — off by default. Selecting it records the
session request; an eligible launch grants the secure-input command scope and
adds the exact fragment below. The control previews this entire block and
shows any provider, executor, or sandbox reason that makes the requested grant
ineffective:

```text
[Client capabilities]
Secure input is available through `ya-agent private-input --prompt <text>`. It returns a temporary file path. Pass that path only to the command that requested it; do not read, display, copy, or place the secret contents in arguments or agent context.
```

`buildEffectiveAgentContext` composes this line with other enabled client
capabilities before free-form global instructions. The fragment is derived
from the effective launch grant, never from a context-only preference. A
session therefore cannot be told that private input exists unless that exact
launch also receives the command path and scoped authority.

Settings may offer **Allow private input requests** as a default for future New
Session forms. It remains default-off, does not modify existing sessions, and
does not independently inject context. The session's explicit value is the
durable authority request.

Automatic advertisement on a resumed transcript must follow the verified
provider placement table in [agent context injection](agent-context-injection.md).
Implementation must either normalize the existing provider differences or use
provider-specific Settings copy; it must not repeat the current inaccurate
blanket claim tracked in
[`gaps/confusing-settings.md`](../gaps/confusing-settings.md).

This reuses the LaTeX setting's exact-preview convention, but not its
context-only ownership. Private input grants a narrow executable capability,
so its control belongs with session launch authority and its description must
state both effects.

Yacron and later commands own separate enablement and advertisement decisions.
Enabling private input must not grant session search, messaging, scheduling,
approval, settings, or provider-control scopes merely because those commands
share one launcher implementation.

## Sandbox and network boundary

A convenient localhost API must not silently weaken a provider sandbox. The
private-input control alone does not enable general network access or disable
the project-write firewall. A launch with no narrow child-to-YA channel is
ineligible and receives neither authority nor advertisement.

General agent tooling may separately offer an explicitly reviewed network-
enabled profile, or a later provider-host IPC bridge may carry the same scoped
operations without broad network access. Either path must preserve the owning
feature's service authorization and must not expose operator routes. Yacron's
existing initial denial for verified sandboxed callers remains unchanged.

## Relationship to existing proposals

### New-session agent tooling

This proposal fills in that document's unresolved packaging, naming, desktop,
and command-directory mechanics. New-session tooling continues to own when a
provider launch receives tools, scoped environment values, capability context,
and instruction-scope choices such as virgin sessions. This document owns how
YA commands are packaged, dispatched, and shared between consumers.

### Agentctl

The implementation is mechanically similar to YA's current agentctl session
bridge: both use an owner-private temporary directory, child environment, a
chained `BASH_ENV` path where necessary, atomic publication, and lifecycle
cleanup. The authority is different. `agentctl` is an external coordination
tool that consumes published session facts; `ya-agent` is a YA-shipped adapter
whose bearer capability calls narrowly scoped YA service APIs. Neither command
replaces or depends on the other.

### Yacron

Yacron keeps one authoritative scheduler service/API, durable store, timer,
and approved `yacron` command vocabulary. The shared runtime can supply the
integrated session launcher and scoped endpoint discovery, avoiding another
desktop sidecar or global installation. It does not solve yacron's durable
service ownership, supervision, queue admission, sandbox policy, or standalone
distribution.

## Implementation checkpoints

### First milestone: self-inspection

1. **Define the self-inspection response.** Project owner identity, launch,
   selected, provider-evidenced, and pending settings from existing state.
   Specify schema version, evidence scope, unknown/default distinctions,
   bounded lookup, and stable failure semantics.
2. **Deliver the read-only command and connection.** Package `ya-agent self`
   and `--json` with YA, provide the command path and session-bound service
   channel for explicitly opted-in local Claude/Codex launches, and enforce
   the own-session read scope. Preserve that binding across canonical-id
   publication and safe reload; reject stale or foreign launch credentials.
3. **Verify ownership and reporting.** Cover aliases, omitted defaults,
   model switches, pending next-turn effort, provider acknowledgement,
   inherited child environments, multiple servers/profiles, resume/remap,
   owner loss, and unauthorized target changes. Verify command delivery on
   macOS, Linux, and Windows, including npm and packaged desktop where
   supported; unsupported sandbox/remote launches fail explicitly.
4. **Document the manual instruction recipe.** Exercise the same command from
   Claude and Codex using operator-managed global instructions. Automatic
   advertisement and its UI are not completion gates for this milestone.

### Later milestones, deferred

1. **Persist the per-session capability request.** Add the default-off New
   Session control, optional future-session default, metadata/resume behavior,
   explicit non-inheritance for new identities, and requested-versus-effective
   status with ineligibility reasons.
2. **Extend command projection.** Reuse the packaged self-inspection runtime
   and private command directory for newly enabled commands; verify the
   expanded grant handling on supported platforms and distributions.
3. **Extend launch authority.** Reuse session/launch binding, revocation, and
   expiry for each new operation scope. Prove that self-inspection credentials
   cannot acquire the added scopes and that unrelated sessions and API routes
   still fail closed. Process ancestry is not an authentication input.
4. **Add private-input service and UI.** Implement create/wait/cancel, the
   authenticated dialog, location-correct owner-only files, redaction, expiry,
   and disconnect/process cleanup without per-session polling.
5. **Project effective context.** Preview the exact fragment, derive it from
   the effective launch grant, and apply it only on the next provider launch
   with honest provider-specific resume behavior.
6. **Move proposed consumers onto the runtime.** Add session-access subcommands
   and the integrated yacron alias only as their owning service APIs and
   authorization contracts become available.

Any client implementation that depends on new server routes, events, settings,
or capability semantics requires the normal stable-release compatibility
review before editing that contract.

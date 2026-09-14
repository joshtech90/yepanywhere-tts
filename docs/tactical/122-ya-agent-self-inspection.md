# YA Agent Self-Inspection

Status: Implemented, 2026-09-08. Validation contract and evidence below.

Topic: ya-agent-self

## Outcome and scope

Implement `ya-agent self` and `ya-agent self --json` as the first YA-shipped
agent command. A local Claude or Codex session can inspect its owning YA
session and distinguish launch settings, current selections, provider evidence,
and pending changes. The command performs no provider work or configuration
writes. Private input, cross-session commands, scheduling, automatic prompt
advertisement, and a New Session UI remain deferred.

Related: [command runtime proposal](../../topics/agent-command-runtime.sketches.md),
[provider host API](../../topics/provider-host-api.md),
[provider runtime status](../../topics/provider-runtime-status.md),
[desktop distribution](../../topics/desktop-v0.md), and
[subprocess environment](../../topics/subprocess-environment.md).

## Verified baseline

- The process REST response includes selected effort, which may still be
  pending. It does not attest to the model executing every in-flight request.
- Claude/Codex already have a late session-id Bash bridge. Source Linux
  non-watch development can retain provider workers across Hono reloads;
  ordinary npm/desktop paths also require direct provider-owner support.
- Seeded mock providers replay messages without running shell commands.
  Codex protocol fixtures already launch real subprocesses and Bash probes.
- npm packaging copies server `dist`; desktop builds the server and deploys
  it with private Bun. The helper must work from these artifacts, without a
  checkout, global Node in desktop, or a separately installed CLI.
- `gaps/agent-facing-env-markers.md` covers a separate compatibility migration.
  Do not expand this feature into renaming the existing wake/browser markers.

## Implementation decisions

- Opt in through `YEP_AGENT_SELF=1` (also accept `true`) for newly launched
  provider processes. Serialize that choice into hosted launch options.
  Default remains off; no global instruction files are changed by YA.
- Put the read-only service at the provider owner, outside replaceable Hono
  when a worker owns the provider. Use a bounded process-local loopback
  listener and private command directory, released when its last lease ends.
  It serves only a versioned self route, never operator APIs.
- Mint an unguessable per-launch bearer capability. Bind it to the canonical
  session as soon as known; validate the caller's optional session-id cross-check.
  Keep credentials out of command arguments, output, and diagnostics. The
  capability expires after 24 hours and is revoked at provider teardown.
- Inject the matching runtime command path and `AGENT_YA_API_URL` /
  `AGENT_YA_API_TOKEN` into supported local child environments. A nested YA
  launch replaces or clears inherited self credentials. YA filesystem
  sandboxes, remote executors, and Codex network-disabled native modes are
  initially ineligible; do not widen a sandbox to make inspection work.
- Maintain an ephemeral observation projection from adapter events and
  controls, with explicit source/scope. Publish supervisor-selected pending
  effort to the provider owner through an optional negotiated RPC. A provider
  control returning successfully is adapter acceptance, not proof of the
  current inference request's settings. Unknown defaults stay unknown.
- Report the owning supervised session, including when a native child agent
  inherits its environment. Do not infer that child's model from the parent.
- The CLI makes one bounded request, emits stable JSON/errors and exit codes,
  and never guesses a server, resumes a session, or polls continuously.
- This additive internal service has no web-client dependency and changes no
  existing capability meaning. It uses its own schema/version check. An older
  server or unsupported launch yields unavailable instead of an API fallback.

## Ordered implementation

### 1 — ship self-inspection service and command

Implement response types, observation projection, scoped service, executable
wrapper, CLI validation, and lifecycle cleanup. Add deterministic tests for
actual command execution and rejected or unavailable contexts.

### 2 — connect Claude, Codex, and retained provider workers

Inject only eligible session environments, bind canonical session ids, observe
model/configuration events and accepted controls, and forward pending selections
across the host boundary. Verify direct and retained ownership and teardown.

### 3 — validate distribution artifacts and CI

Exercise a scripted provider through production launch/bridge code and execute
the real command against the real service. Seed known model/effort, synchronize
pending and applied changes, and test multiple owners. Test source delivery,
installed npm artifacts, and desktop resources with Bun. Add explicit CI gates
on supported platforms; required coverage must fail rather than silently skip.

### 4 — publish the durable contract and verify the pushed change

Document opt-in, eligibility, response provenance, failure behavior, and the
manual Claude/Codex global-instruction recipe. Update proposal/roadmap status.
Run scoped tests and repository checks, commit intentional slices, push, and
verify CI for the exact pushed commit. Record any real-provider acceptance
checks separately from deterministic coverage; cloud inference is not a CI
prerequisite.

## Acceptance criteria

- Actual child shell finds and executes the matching command in source, npm,
  and desktop distributions; no checkout/global runtime dependency leaks.
- Ownership and credentials remain isolated between simultaneous instances.
- Launch, selected, observed, unknown/default, and pending values are distinct.
- Fresh/resumed/remapped sessions and retained-worker reloads remain correct.
- Expired/revoked/foreign credentials, missing owner, and unsupported versions
  fail explicitly without provider mutations or leaking credentials.
- Unsupported remote/sandbox launches receive no self grant. No idle polling
  or abandoned listener/directory remains after the last session ends.
- Relevant checks and the required CI jobs pass for the pushed commit.

## Implemented result and local evidence

The current contract is [Agent Own-Session Inspection](../../topics/agent-self.md).
The service and CLI ship inside the server; Claude/Codex launch integration
and optional retained-worker selection RPC are implemented. The Bash bridge
captures its original startup file at launch and reasserts the current self
grant, so nested startup scripts cannot restore an outer capability.

Local checks passed on macOS: repository lint (zero warnings), formatting,
typecheck, the focused provider/ownership tests, installed npm artifact smoke,
and desktop resource smoke with private Bun. Deterministic coverage includes
real shell execution, pending effort application, controller reattachment,
canonical-id remapping, expiry, credential isolation, and grant revocation.
CI adds required source coverage on Linux/macOS/Windows and installed npm
coverage on Linux; the existing desktop gates execute the Bun artifact probe.
Live cloud-provider inference is not part of this deterministic validation.

The publication gate is green CI for the exact pushed commit, including the
three-platform source and distribution artifact jobs. Changes ship directly
to main; this tactical and the linked implemented contract provide the durable
implementation record.

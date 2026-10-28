# Session Wake Turns

> Session wake is addressed event delivery that gives a recipient session
> another turn, including authorized resumption when needed; it belongs at
> the provider API boundary, independently of the YA web server.

Topic: session-wake

Status: **keep or redesign; do not remove**, selected 2026-10-27 in
[core house cleaning](core-house-cleaning.md), row 6. The capability is
retained; its current YA-server implementation is not the desired owner.

Related topic: [provider host API](provider-host-api.md) — provider-owned
addressed turns, queueing and receipts independent of Hono.
Related topic: [heartbeat retirement and retained maintenance](heartbeat.md) —
synthetic periodic turns are removed; transport health and patient work remain.
Related topic: [session liveness and queue intent](session-liveness.md).
Related topic: [session ownership](session-ownership.md) — why a second
writer on a provider transcript is never acceptable.
Related topic: [YA environment variables](ya-env-vars.md) and
[subprocess environment boundaries](subprocess-environment.md) — the
injection channels.
Related topic: [ask-session](ask-session.md) — proposed ask/reply
consumer of the wake ladder.

## Value and retained capability

A session should be able to continue when an authorized external event gives
it new information or satisfies a dependency. The sender addresses the
recipient; the recipient's provider owner delivers the message through its
normal input queue and resumes the session when permitted. A browser need not
be open, and a human need not relay the event.

This is useful in multi-session orchestration:

- A worker completes a task and sends its result to the coordinating session.
- An advisor replies and the requesting session continues its decision.
- A review finishes, a resource becomes available, or another session releases
  a dependency, allowing waiting work to continue.
- An external job completes and reports its outcome to the session that owns
  the next decision.

Harness-native background-job notifications may handle the last example for
jobs a harness owns. They do not eliminate the need to address sessions across
independent agents, tools and event sources. The lasting value is authorized
delivery and resumption, not compensation for a particular harness defect.

The sender supplies the event or result. The recipient's instructions decide
what to do with it. Wake delivery does not require a scheduler, recurring
synthetic prompts, or a general orchestration engine.

## Selected ownership: provider API

Implement this ability at the provider API boundary, owned by the provider
server/runtime. The YA web server must not own wake-specific queueing,
resumption or orchestration policy. It may act as an authenticated transport
adapter or present status, but delivery must not depend on Hono or a browser
remaining alive.

The existing [provider host API](provider-host-api.md) already exposes
addressed turns, eventual queueing and submission receipts. Redesign should
reuse that ownership and admission machinery, rather than add another input
queue or resume controller. Its current runtime/platform restrictions still
apply; this direction does not assert that the HTTP wake path has migrated or
that every provider already supports independent wake delivery.

Preserve these outcomes through redesign:

- Address the intended durable session and deliver through its sole provider
  owner; never spawn a competing transcript writer or silently fork it.
- Queue while the recipient is busy according to explicit delivery semantics.
  Resume an absent recipient only when authorized and eligible; preserve
  explicit kill, archive and automation-pause protections.
- Bound sender authority to the intended recipient and operation. Sending a
  result must not confer general session control.
- Keep admission, queueing, execution and failure observable, with bounded
  payloads, retained state and resource use.
- Use the provider API's submission identity and receipts where applicable;
  settle retry and duplicate semantics for actual callers rather than imply
  reliable delivery from the current best-effort HTTP client.

Keep the current path working until consumers can move to the provider API.
Then retire superseded YA-server routes, credentials, environment injection
and resume branches together. This is replacement of an implementation, not
removal of the ability. Detailed migration and protocol choices remain separate
implementation work; no new scheduler or broad orchestration framework is
required by this decision.

## Current implementation contracts (YA-server path)

The following describes the existing implementation, pending redesign. Its
server-owned delivery ladder is not the target architecture above.

- A wake turn uses the ordinary server-owned message enqueue path. It obeys
  the normal queue/steer delivery semantics, resets the same liveness
  anchors, and is visible in the transcript like any user message.
- Endpoint: a session-scoped wake route accepting
  `Authorization: Bearer <wake token>` and JSON `{text, source?,
  jobId?}`. Clients never construct the URL: they receive it fully
  formed in `YEP_SESSION_WAKE_URL` and treat it as opaque, so the
  route's exact path shape stays an implementation detail. Credentials are
  checked before any payload read. The HTTP body has an 8 KiB streamed hard
  limit (with declared length used only for early rejection); text is capped
  at 2000 characters and delivered verbatim.
- Auth is a per-session wake token — an HMAC of the YA session id under
  a persistent, owner-readable server secret — verified statelessly with a
  constant-time compare.
  Possession authorizes exactly one thing: queueing text into that one
  session. The cookie-auth surface is not involved, and the token never
  appears in logs.
- Feature-gated at delivery time, default off (vanilla-defaults): a
  global `wakeTurnsEnabled` server setting enables the endpoint, and
  per-session `wakeTurnsEnabled` metadata overrides it (`null` clears the
  override). A POST for a disabled session is rejected with 403; invalid
  credentials receive 401 without consulting or revealing the feature gate.
- Delivery ladder, server-owned:
  - live registered process → queue the turn;
  - no live process → resume-then-deliver through the retained automatic-resume
    gate, never for archived or `autoResumeDisabled` sessions. A transcript
    ending in a pending tool call is not required: the wake text supplies the
    reason to resume. Automation-pause protections also remain.
  - Explicit Kill semantics are unchanged: `autoResumeDisabled` blocks wake
    resume and other automatic process starts, including cold recaps.
- Env injection: provider children of a supervised session receive
  `YEP_SESSION_WAKE_URL` and `YEP_SESSION_WAKE_TOKEN` through the same
  channels that carry `AGENTCTL_SESSION_ID` today — spawn env for
  Codex, the agentctl `BASH_ENV` bridge for Claude. Injection is
  unconditional once the server supports the feature; the settings act
  at delivery time. This keeps enabling mid-session working without a
  process rotation, and the env inert while the feature is off. A plain local
  HTTP server derives the URL from its live localhost port. Remote executors
  and self-signed-HTTPS servers require `YEP_SESSION_WAKE_BASE_URL` to name an
  HTTP(S) origin the child can reach and trust. Claude remote resumes receive
  the env at spawn; a brand-new remote Claude session cannot receive it after
  its canonical id is learned because YA has no remote shell-env mutation
  channel yet.
- Per-session rate limit: burst capacity 3, refilling one wake per minute.
  Excess wakes receive 429 and are logged, never queued unboundedly. The
  in-memory buckets are LRU-bounded and refill from request timestamps, so
  wake handling creates no polling or timers (architecture-mandates).

## The agentctl client

The first producer is an `agentctl` plugin (`agentctl_plugins/wake.py`
in the agentctl repo, summarized in that repo's `topics/agentctl.md`):

- Arms only for agent-level launches (launch depth 0) whose launcher
  env carries `YEP_SESSION_WAKE_URL`; a `--no-wake` launch flag opts
  out.
- Fires from `on_finish` in the detached run wrapper — which survives
  agent-session teardown and inherited the launch-time env — so the
  wake happens even when the launching turn is long gone.
- The POSTed text is one factual line, e.g.
  `[agentctl-wake] job <name> finished returncode=<rc> elapsed=<t>
  log=<path> out=<path>`, with the last log line appended on failure.
  What to do on receipt (consume the completion, launch the successor)
  is the agent's standing instructions, not the wake text's job.
- Best-effort: stdlib HTTP, short timeout, one retry; on failure it
  writes one line to the job log and stops. This does not guarantee delivery;
  heartbeat removal must not be compensated by adding periodic wake prompts.

### Provider-CLI injection fallback (not implemented)

The documented `agentctl` wake plugin does not invoke a provider CLI when the
YA environment is absent. The earlier direct-CLI fallback proposal is
superseded by the provider-API direction: a producer submits to the session's
owner rather than implementing provider-specific resume itself. No caller may
create a competing writer when the owner is unavailable. Native resume and
fork behavior belongs in the provider adapter's verified contract; it must not
be inferred from a missing wake URL.

## Representative Change Types

- Moving delivery and authorized resumption to the provider API while
  preserving callers and session ownership.
- Adding the wake route, token minting, or delivery-time gating.
- Changing wake env injection channels or names.
- Changing resume-on-wake eligibility or its interaction with archived
  and `autoResumeDisabled` state.
- Changing wake rate limits or the text cap.

## Tests That Should Fail On Contract Regressions

- A wake POST with a valid token queues a user turn on a live opted-in
  session even when no browser session page is open.
- A wake POST with a wrong token, or for a disabled session, is
  rejected and queues nothing.
- A wake POST for an opted-in session with no live process resumes it
  and delivers the turn; the same POST for an archived or
  `autoResumeDisabled` session does neither.
- Wake turns respect the per-session rate limit, and dropped wakes are
  logged rather than delivered late.
- Env injection provides the URL and token to the Codex spawn env and
  the Claude `BASH_ENV` bridge without either value reaching logs.

For the redesigned path, acceptance must also demonstrate delivery without
the YA web server, safe busy-recipient queueing, and authorized resumption
without a second owner. Provider API receipts must distinguish acceptance
from completion and support the selected retry contract. Existing HTTP tests
alone cannot establish those outcomes.

## Historical motivation

The first implementation followed a 2026-08-09 incident: a detached training
chain finished after its agent's final turn, and the GPU remained idle for ten
hours. Job-completion wakeups addressed that missed continuation. This incident
explains the first consumer; retaining the capability does not depend on the
same harness limitation persisting.

# Agents cannot poll whether the user is monitoring their session

Status: proposal only; no implementation or automatic injection enabled.
User-directed, 2026-09-21.

## Purpose

Expose a fresh, session-specific user-presence indicator that an agent can
query when deciding whether to ask a blocking question or continue toward the
requested completion. For example, the user leaves a session running and
expects the agent to finish; an optional preference question should not
unnecessarily strand the work while nobody is watching.

The default design is **pull-based**: presence is accessible on request, not
injected into routine turns or repeated system reminders. A separately enabled
push mode could steer an active agent after a timeout with a notice such as
"The user is not actively monitoring this session."

Presence and direction are separate facts. Losing focus does not establish
that the user wants autonomous completion; retain the actual request or an
explicit session preference for that. Presence helps choose when to ask and
whether to continue independent work. It does not answer a pending question or
change the authorization needed for an action. An agent can report a necessary
blocker while making progress on everything that does not depend on it.

## Available building blocks

- `packages/client/src/hooks/useDocumentAttention.ts` already combines
  `document.visibilityState === "visible"` with `document.hasFocus()` and
  subscribes to visibility, focus, and blur changes. This is a browser attention
  proxy, not evidence that a human is reading.
- `packages/server/src/supervisor/SessionViewerPresence.ts` counts mounted
  live-session streams for provider lifecycle management. A registered viewer
  alone does not establish foreground attention or willingness to answer.
  Keep its existing lifecycle meaning intact.
- [Own-session inspection](../../topics/agent-self.md) provides an opt-in,
  read-only `ya-agent self` command and a session-bound service. This is a
  possible carrier for presence; it does not currently expose this signal.
- [Subprocess environment boundaries](../../topics/subprocess-environment.md)
  explains why updating YA's environment cannot update an already-running
  provider's environment. Dynamic status needs a live channel or explicit
  bridge, not an assumed environment-variable mutation.

Related designs include the
[agent command runtime](../../topics/agent-command-runtime.sketches.md),
[participant seats](named-participant-seats.md), and
[vanilla defaults](../../topics/vanilla-defaults.md). Presence reporting is
distinct from session/process liveness, Inbox attention, and viewer counts.

## Proposed signal and transport

Prefer server-owned, session-scoped state, polled through the existing
own-session channel or a comparably narrow read interface. A session-specific
flag is another possible transport; an environment variable can publish a
stable locator for it. If a per-tool shell bridge publishes a status snapshot,
label its timestamp and scope: it is not a live variable inside an already
running shell or agent process. Exact command, field, and environment names
remain design choices.

Candidate states are `attentive`, `away`, and `unknown`, with observation time,
state-change time, freshness/expiry, and a terse evidence reason. `Attentive`
means a qualifying client currently has this session visible and focused;
`away` means an observed loss of those conditions persisted past a grace
period. No client evidence, expired reports, disconnection, or unsupported
focus reporting must remain distinguishable from affirmative absence.
The poll result should not merely return a stale Boolean.

The browser should report the conjunction of document visibility/focus and
which session content is actually being viewed. A route change to another
session matters even if the YA tab remains focused. A tab hidden behind another
tab, an unfocused browser window, OS application-focus loss, or device lock
can indicate loss of attention where the platform exposes it. Native desktop
focus events may improve evidence, but browser signals must not be described
as universal OS foreground detection. Split panes and related artifact windows
need an explicit policy rather than treating every route change as departure.

Aggregate across the intended user's clients: a focused phone view can keep a
session attended after its laptop tab loses focus. A background tab must not
overwrite a newer foreground observation from another client. In shared
sessions, identify whose availability matters; an anonymous read-only viewer
is not evidence that the requesting user can answer. Reuse existing principal
and session ownership boundaries rather than letting clients or agents inspect
arbitrary users' activity.

Use transition reports with a bounded lease/heartbeat and server-side expiry,
not per-keystroke telemetry. Cancel the away timer if attention returns before
the grace period. An optional explicit "away; continue to completion" session
choice can state both availability and intent, while keeping those fields
separate. Do not interpret a long period without typing as absence when the
user may be reading.

## Agent use and optional push mode

An agent polls at a decision point where availability changes its next action,
such as an optional blocking preference question, rather than before every
tool call. Fresh away evidence plus an existing request for completion favors
reasonable reversible choices and continued work. `Unknown` is not an answer
and should not itself create a new confirmation requirement. Presence polling
does not keep idle provider processes alive or create an autonomous wake loop.

The optional push mode is separate and default-off. After sustained focus or
session-visibility loss, deliver one coalesced presence notice through a
supported active-turn steer path. Recheck the state when sending; cancel
pending notices on return, avoid focus-flapping spam, and attach an observation
time so an old notice cannot masquerade as current evidence. A return transition
should supersede an already-delivered away state through the same opt-in
mechanism or an explicit freshness rule.

The notice is YA-generated observation, not a forged user instruction to take
new actions. It must not interrupt a pending approval, answer a question,
cancel work, or launch an idle session just to announce absence. Preserve
provider-specific steer/queue semantics and expose unsupported delivery rather
than silently converting the signal into an ordinary new task turn. Exact
timeouts, client eligibility, return-notice behavior, and delivery policy need
to be chosen before implementation.

## Verification and open decisions

Test focused/visible, visible-but-unfocused, hidden, another-session-in-same-tab,
short blur then return, sustained absence, stale heartbeat, disconnected client,
and unsupported focus reporting. Include multiple devices, shared viewers,
split panes, artifact windows, and provider resume/child-agent ownership.
Verify that polling reflects changes during one long-lived provider process,
and that missing evidence produces `unknown` rather than guessed absence.

For pull-only operation, assert no presence content is appended to ordinary
provider turns. For opt-in push, verify timeout cancellation, delivery-time
rechecks, deduplication, return handling, and no idle-session wakeup. Inspect
the actual provider-bound input and test disconnect/reconnect races. Agent
behavior checks should include an optional preference, a genuinely required
decision, and a user who explicitly asked the agent to wait.

Initial recommendation: implement a pollable session state with freshness
first, reusing browser attention and the own-session access channel where
supported. Evaluate false-away reports and whether agents avoid unnecessary
waiting before adding push delivery. This proposal does not approve runtime
changes or reprioritize the roadmap.

Found 2026-09-21 while discussing agent-visible user availability and unattended
completion. Contributing-model: 6-Astra.

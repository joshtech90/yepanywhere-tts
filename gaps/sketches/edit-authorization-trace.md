# Edit attribution can place an edit, not explain it

What YA can attach to an agent edit automatically is its *position*: the
canonical session and the transcript location of the mutation (turn id and
tool call id), plus the facts the harness already knows about the latest
delivered user input before it (participant seat and authorization kind, per
[named participant seats](named-participant-seats.md)). That is cheap,
deterministic, and always available, and it is what
[turn-anchored edit provenance](turn-anchored-edit-provenance.md) records.

The contextual understanding a reader actually wants, which ask this edit
serves and under whose authority, is only *implied* by that position. In a
long-running session the agent may be executing step three of an explicit
plan, a handoff file, a `/goal`, a queued request, or a self-chosen subgoal
whose originating ask is many turns back. Recovering that from the transcript
is an interpretation problem: a human reading the session, or a cheap
session-understanding model, can usually do it, but not for free and not
reliably.

## Record all three

- **Position, always.** Session, transcript position (turn id, tool call
  id), observed time. Never replaced or edited by anything the agent says.
- **Previous-turn default, always.** The latest delivered user input before
  the mutation, with its participant seat and authorization kind. This is
  the harness's free heuristic for "who asked": trivially recoverable by
  anyone with session-log access by scanning back from the position, and
  usually right. Storing it saves the scan and fixes the answer at
  observation time even if the transcript is later compacted or forked.
  Session logs are not what a shared public repository exposes, so this
  record does not leak authorship the repository itself would not.
- **Declared trace, when present.** An agent-declared *authorization trace*
  naming the ask it believes it is serving and the authority it is acting
  under: a source input id or turn, a plan step or handoff reference, a
  goal, and a one-line why. Recorded beside the other two, never substituted
  for either. A trace is a claim by the model and is labeled as such in every
  projection.

A later re-attribution pass (human or a cheap model reading the session) may
add a dated judgment on top. It does not overwrite any recorded layer, and a
projection shows which of the three or four answers it is displaying.

## Cost model

Asking an agent to edit differently from how it was trained is expensive, so
the semantic layer must not cost tokens per edit. The harness carries a
default trace for free: the latest delivered user input. The model pays only
at *transitions* the harness cannot see, when it starts acting on an older
ask, a plan step, a handoff, or a subgoal. A declared trace then persists
until an event ends it: the next delivered user input, an explicit
replacement, or a generous edit-count cap as a backstop. Expiry purely after
N edits would force refresh tokens exactly when the agent is mid-task, so it
is the backstop, not the rule.

Compliance at transitions is the unavoidable cost, and it is instruction
driven: the agent's global or project instructions tell it when to declare a
trace. That is model- and harness-general, which is why the instruction half
of this design is of interest beyond YA.

## Delivery to tools

A trace should reach edit tools without the model restating it. YA's
per-command `BASH_ENV` bridge that publishes the session id is the precedent
([child launch markers](../../topics/ya-env-vars.md#child-launch-markers)); the current trace can
be published the same way as an environment value or a small file path.

- **Pickup if present, everywhere.** The provenance observer copies the
  current trace onto each mutation row for every provider.
- **Refusal, where a deterministic hook exists.** Claude Code's pre-tool
  hooks can block an Edit or Write and return a message, so a hook reading
  the trace can refuse an unauthorized edit at no model cost beyond the
  retry. Codex has no equivalent hook; YA could gate only through its
  approval path. Refusal is therefore a per-harness, opt-in mode; pickup is
  universal.

## Trace shape

One small record: requester seat, source input id or turn, authorization kind
(driver send, send-enabled guest send, driver-applied proposal, tool
approval, plan step, handoff, goal), optional reference (plan path and step,
handoff file, goal text), created-at, and the expiry rule in force. It is the
edit-level analogue of the `Contributing-model:` commit trailer.

## Boundaries

YA ships no instruction text into provider prompts for this
([vanilla defaults](../../topics/vanilla-defaults.md)); the instruction that
triggers trace declaration is operator-managed, like the
[agent self](../../topics/agent-self.md) recipe. The instruction-based
prototype, once built, belongs in the shared agent-instruction corpus with a
pointer back here; YA owns the mechanical layer, the bridge, and the
recording. Whether refusal should ever be on by default, the exact trace
format, and how a cheap re-attribution pass is invoked remain open.

Found 2026-09-15 while refining edit provenance for shared sessions.
Contributing-model: fable-5.1

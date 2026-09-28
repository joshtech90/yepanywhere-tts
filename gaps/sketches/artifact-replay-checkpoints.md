# Optional checkpoints and replay capture for structured artifacts

Status: design sketch, not implemented. Requested 2026-09-21.

Companion to [artifact review comments](artifact-review-comments.md), which
owns annotation UI, proposal rounds, session delivery and the generic
fixed-dimension reproduction baseline. This sketch owns optional ways to make
long or highly dynamic reproductions compact and inspectable. Neither
Plannotator adoption nor basic artifact commenting depends on implementing it.

## Intent and example

A game loop may run thousands of ticks before the user comments on an object.
The agent should receive a short explanation and an explorable replay reference,
not thousands of tick records in its prompt. An adequate snapshot can replace
the causal input prefix for the purpose of reproducing the observed state.
It does not explain why the application originally reached that state.

Example delivery, illustrative rather than a chosen file format:

> Revision R, 960×540 CSS-pixel viewport, device pixel ratio 2.
> Comment: the player overlaps this platform.
> Restore checkpoint C at tick 18,000; hold ArrowRight for 120 fixed steps;
> inspect object platform-7 at tick 18,120. Source mapping: build map M.
> Replay bundle: host-accessible reference B, manifest and short summary.

An uninstrumented alternative might say “from this starting state, hold
ArrowRight for about two seconds, then inspect the overlap.” Label that recipe
approximate and retain the observed screenshot. Do not silently equate two
wall-clock seconds with 120 simulation steps.

## Four forms of reproduction support

| Form | What it preserves | What it may omit |
| --- | --- | --- |
| Visual checkpoint | Screenshot, dimensions, target and descriptive state | Executable state and the actions that reached it; this is observation, not restoration. |
| Restorable checkpoint plus suffix | Declared application state at a boundary, required environment, and later inputs | Earlier inputs when the saved state is sufficient for the claimed reproduction. |
| Lossless trace compression | Input transitions or semantic operations instead of repeated equivalent records | Redundant representation only; reconstruction must preserve relevant timing/order. |
| Approximate recipe | Compact actions such as key hold, drag, or “advance until menu visible” | Exact event timing or incidental state, explicitly marked with tolerances and expected observations. |

No snapshot of generic DOM or pixels claims to restore arbitrary application
state. Each checkpoint declares its fidelity and omitted dependencies.
Checkpoint acceleration is optional and may only work for producers using a
supported framework or adapter.

## Checkpoint boundaries and what is saved

Capture at a consistent application boundary, such as immediately after a
simulation step, not halfway through a mutation or render. The producer defines
save/restore semantics and a state-schema version. A restorable checkpoint
names the exact build and assets, logical tick/time, random-generator state
where controlled, model/store state, active inputs, and required fixture or
external-result references. Include pending work only if its ordering and
state can be represented; otherwise require a quiescent boundary or lower the
fidelity claim. Workers, audio, graphics resources and network effects need
declared adapters or exclusions, not presumed coverage.

Prefer the smallest state sufficient for the intended reproduction: model
state from which a framework can rebuild the view may suffice. A selective
snapshot is valid only with a declared scope, such as reproducing menu layout
rather than subsequent gameplay. Verify restore in a fresh instance, not just
in the still-running producer whose hidden state may mask omissions.

A checkpoint can elide its earlier input prefix after restore-plus-suffix
has been verified for the stated observation. Keep provenance such as the
covered tick range and omission reason. For a question about how the bug
arose, retain or separately reference the earlier trace when available;
starting at a bad state reproduces its appearance, not necessarily its cause.
Never discard a prefix still required by another annotation or checkpoint.
Cap delta chains and periodically materialize independent checkpoints so a
small reference does not conceal an unbounded restore dependency chain.

## Compact input recipes

Candidate operations include press/release, hold for a duration or logical
step count, pointer movement/drag, wait for a named condition with a timeout,
and a producer-defined semantic action on an object id. Define units, clock,
coordinate space, initial held-input state, endpoint state and expected
observations. Release held keys on completion, failure and cancellation.

For a fixed-step loop with controlled inputs, storing key transitions and
their tick numbers may replace per-tick copies without information loss.
For wall-clock or event-driven apps, “hold right for 2 seconds” is normally
an approximate recipe unless repeat events, timing and relevant scheduling
are controlled. Preserve actual event ordering where it affects behavior.
Approximate recipes state success criteria, for example reaching the same
menu or an overlap within a declared tolerance, rather than claiming identical
pixels. Semantic operations require producer-supplied meaning; do not infer
“jump” solely from an arbitrary key code.

## Large state and traces as explorable references

Keep a bounded human/agent summary inline. Write large snapshots, event chunks,
fixtures, screenshots and source maps into a replay bundle with a small index.
Each reference identifies an immutable payload by hash, size and media/schema
type, plus the relevant checkpoint/event range and its dependencies. Permit
inspection of the manifest, a selected object, a tick range or one payload
without reading the whole bundle into model context. The replay entry names
the compatible build/adapter and setup; actual command/API syntax is TBD.

“Tmpfile out” means a real, resolvable file or retained attachment reference
available to the destination agent, not a browser blob URL or a path on the
wrong machine. Materialize through YA's existing authorized storage/attachment
path, defaulting to app data under [project storage](../../topics/project-directory-storage.md).
For sandboxed/remote sessions, prove accessibility or explicitly deliver the
bundle to that execution environment. Do not rely on access to the YA host's
temporary directory. A browser replay link and an agent-readable reference
may differ while identifying the same bundle.

Declare retention/expiry and ownership. Keep required files while unsent
drafts or retained review records reference them; an OS-cleared temp path is
insufficient for a claimed durable replay. Publish a manifest only after its
required payloads are complete. Missing, expired or mismatched data produces
an explicit limitation while leaving the inline summary useful. Bound capture
and storage, redact sensitive inputs, and never package ambient credentials.

## Metaprotocol and producer library: TBD

The metaprotocol describes optional capture capabilities rather than dictating
one UI or engine. Candidate capability descriptions cover labelled targets,
source mappings, semantic input, capture/restore state, controlled clock/randomness,
and replay verification. A checkpoint record ties these to build/state-schema
identity, environment, payload references, a suffix and a fidelity claim.
Version and validate these independently of the annotation UI's data types.

Attach metadata to DOM/SVG elements when possible: object/instance id, source
span or map reference, and references to annotation/checkpoint records. Keep
large state outside attributes. For canvas/WebGL or objects with no DOM node,
use a producer registry with hit regions and stable identities; that registry
is the out-of-band equivalent. A transient element's identity/state remains
referencable after removal. Producer metadata is descriptive, never authority
to read paths or execute commands.

Do not choose attribute names, a wire schema, a library or a mandatory framework
yet. Prototype the minimum record that can restore one state, resolve one
object/source target, and deliver one review comment. A later producer skill
can emit the agreed metadata and select an adapter; skill authoring is separate
from this sketch. Plannotator can consume annotation projections while the
replay bundle remains usable without it.

## Interception while keeping ordinary application code

Desired author experience: usual event handlers, rendering and game/app APIs,
with capture added at a small number of integration points. The proposed
“aspect-style” approach intercepts selected operations at those boundaries
rather than scattering trace calls through every function.

| Candidate | Advantage | Limit |
| --- | --- | --- |
| **Opt-in framework/engine adapter plus explicit save/restore** | Normal app API remains recognizable; adapter intercepts input, step scheduling and labelled objects at known boundaries. | Supports selected frameworks and state shapes; some producer cooperation is unavoidable. |
| Build-time instrumentation | Can attach source/object metadata and intercept imports/calls with little author repetition. | Must preserve semantics and source maps; dynamic code, workers and unsupported APIs need explicit exclusions. |
| General page-level runtime interception | Can observe selected browser API calls without changing application source. | Cannot recover arbitrary private state or guarantee control of all effects; suitable for a bounded subset, not universal replay. |

**Initial candidate:** one template/framework adapter with explicit state
serialization. Intercept only declared services: input delivery, logical
clock/step scheduling, deterministic randomness when available, and selected
fixture I/O. Use framework extension points or scoped dependency injection
where possible. Any API wrapping must preserve calling conventions, return
values, cancellation, errors and listener lifecycle; recording must not invent
a second application state owner. Replay chooses controlled services before
startup, not by mutating a live session underneath the user.

This likely requires intrusive integration into the code causing the UI, even
if ordinary author code stays mostly unchanged. Treat support as a declared
capability, not a universal browser trick. Interception that is disabled must
leave native behavior intact and avoid capture work; prove record-on behavior
does not change the scenario. Isolate replay from external side effects.
Do not expand YA's [composer-only semantic UI harness](../../topics/semantic-ui-actions.md)
into an artifact engine: its target and authority are different.

## Bounded trial and decision criteria

1. Use one generated fixed-step game or small stateful App with a menu and
   labelled objects. Record a long run, capture at a stable boundary, then
   comment on a transient state after a short input suffix.
2. Restore in a fresh instance and compare the declared state/visual predicate.
   Show the inline review remains short and its referenced payload can be
   inspected and replayed by the actual destination session. Measure capture
   overhead and retained bytes before choosing budgets.
3. Compare a complete trace, checkpoint-plus-suffix, and approximate key-hold
   recipe. Record fidelity and first divergence; test a missing hidden-state
   dependency to prove the verifier detects an incomplete checkpoint.
4. Verify paused/cancelled replay releases inputs; mismatched builds, missing
   chunks and expired references fail clearly; annotations retain their own
   revision/checkpoint when the producer advances.
5. Decide whether existing library/framework seams suffice, a small wrapper
   earns its cost, or richer replay should remain unsupported. Prefer reusable
   upstream extensions when helpful, including Plannotator seams for carrying
   replay references, without assuming Plannotator owns application simulation.

Done for this optional trial: a long interaction prefix can be omitted from
the prompt and, for a verified checkpoint, from replay, while the agent can
inspect the retained reference and reproduce the declared target state.
Approximate recipes remain explicitly approximate. Ordinary artifact review
continues when none of these optional capabilities exist.

Found 2026-09-21 while specifying checkpoint accelerators, file-backed replay
details and optional aspect-style capture for artifact comments.
Contributing-model: 6-Astra

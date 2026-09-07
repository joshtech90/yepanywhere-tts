# Workflow view

> Proposal: Workflow view groups a workflow's declared parts, progress, outcomes,
> and associated activities under a shared workflow ID, initially as a
> collapsible outline within one agent turn with no workflow input from the user.

Status: The simple boundary-creating / tag-highlighting v1 is implemented.
The collapsible workflow outline and richer views described below remain
proposals. The first implementation is a display-only, single-turn projection;
the calling session knowing and emitting the workflow ID is sufficient.

## Implemented v1 contract

**Appearance → Workflow tag highlighting** is a browser-local, default-off
setting with the pane's normal Undo behavior. When enabled, explicitly
activated tags create visual boundaries and display declared title paths
inside existing transcript rows. Repeated paths retain their source order.
No provider messages, turns, commands, or completion events are synthesized.

- The inline `@@visualization-schema/1 ["build",["check","types"]]` form
  accepts exact paths in assistant text and tool output. Activation can arrive
  from either source; a tool activation applies only from its own marker
  onward. It ends at the next valid activation or user/compaction boundary
  without asserting completion.
- A file-only announcement in assistant text or tool output resolves through
  the connected YA server's authenticated
  `GET /api/projects/:projectId/files/raw?path=...` route. The browser parses
  the returned source text: either a JSON declaration or a document containing
  a fenced JSON declaration. An absolute, home-relative, drive-qualified, or
  UNC pointer identifies the file; `#id` selects exactly one schema. Home
  expansion and filesystem access happen on the server. Local Access path
  settings govern this read, just as they govern file viewing.
- A complete declaration already embedded in the announcing tool result takes
  precedence and needs no file fetch. Native Read results use their structured
  text-file body, avoiding display-only line-number prefixes. Only
  `tagged-stages/1` is supported. Missing/denied files, invalid or ambiguous
  declarations, partial responses, and fetched text over 1,048,576 characters
  remain ordinary output with an unresolved marker. Unbased paths and web URLs
  are not fetched. Skill metadata alone does not activate this renderer.
- Exec output uses the same shared `decodeCodeModeOutput` contract as its
  ordinary renderer. Typed text arrays, including serialized arrays and the
  recognized single-command/fulfilled-result envelopes, expose their actual
  stdout to workflow parsing. Each decoded part is parsed separately: fences,
  embedded declarations, and nested activations do not cross result boundaries.
  Script-status headers are excluded. Unknown or mixed-media envelopes remain
  literal, and stdout is a leaf rather than recursively decoded JSON. Original
  input remains available in the ordinary renderer's raw detail.
- Fetched declarations have a five-minute TTL, with a tab-local cache keyed by
  source, project, session, and reference. After expiration, the next render
  use, return to a visible tab, or source-ready notification revalidates using
  `If-None-Match`. The raw-file route's weak ETag includes mtime, ctime, and
  size. A `304` reuses the cached content and renews its TTL; a changed `200`
  replaces it and updates the display. A server without a validator receives
  an ordinary read after expiry. Failed reads stay unresolved and wait five
  minutes before another demand attempt in the mounted view; a denied
  revalidation drops cached content. There is no background polling. Disabling
  the setting or leaving the session releases listeners and aborts direct
  reads. Relay requests keep their existing bounded request lifetime, but late
  completions cannot update a disposed view. Browser persistence is optional.
- A full declaration requires matching assistant `[workflow][start]` and
  schema IDs before stage highlighting begins. Only a matching explicit end
  displays the producer's completed/blocked/failed report. Moving stages or
  receiving a successful tool result never supplies a workflow outcome.
- Assistant fences, quotes, undeclared gates, and ordinary bracketed prose
  cannot activate or advance a workflow. Invalid activations preserve the
  previous valid interpretation. A streaming final line is recognized once
  its newline arrives or the block completes.
- Tool calls capture their parent stage and effective output policy when
  launched. Results are interpreted in source-message arrival order, so an
  agent's later stage does not adopt an earlier call's output. Enabled tool
  tags are relative to that captured parent. `closed: true` admits declared
  descendants (including intermediate paths) plus exact whitelist entries;
  the whitelist is always additive. Open matching admits every valid path,
  with or without a whitelist. An empty closed set matches nothing. A child
  either inherits the whole tool policy or replaces it, with omitted Boolean
  fields defaulting false. Descendants are resolved at the captured calling
  stage, not the ancestor that declared the policy. Tool lifecycle-looking
  tags are only data. Both `spans` and `matching-lines` use the same matching.
- A script's own inline activation is independent of `containsTags`. When
  the call already has a workflow context, its new whitelist applies locally
  beneath that captured parent, preserving the parent's declared title. It
  does not replace the assistant's schema or stage, or another running call's
  context. Without a calling context, a tool activation also supplies the
  schema for subsequent assistant activity. This scopes the producer
  convention's "subsequent activity" to the invocation when it is nested.
  For example, a script called under `[publish][client]` can announce
  `[["build","types"],"copy"]` and produce
  `[publish][client][build][types]` and `[publish][client][copy]` boundaries.
  Earlier output retains its previous interpretation, including lines hidden
  by `matching-lines` before the script switches to inline `spans`.
- Highlighted assistant blocks show their literal source with tag/title
  boundaries. **Original output** exposes the existing rich message renderer
  and its copy/quote controls. Tagged tool previews likewise retain the full
  original output, including lines omitted by `matching-lines`. Opaque tools
  keep their ordinary renderer beneath the captured stage label; declared but
  unobserved children produce no progress rows. Conversation View still
  controls whether routine tool activity is expanded.
- Replay derives the same projection from the same source records and resolved
  declarations. Embedded declarations remain historical snapshots. A file-only
  pointer refers to mutable external content: revalidation can change its
  labels, and is not frozen historical evidence. Neither form rewrites the
  canonical announcement or tool output. Projection runs before
  the browser's conversation/render window. If a server history page omits
  the activation, v1 leaves tags ordinary until the earlier source is loaded;
  it does not guess the missing schema. Subagent streams are not activated by
  their parent's declaration.

The implementation lives in `transcriptProjection/workflowTags.ts` and the
shared `WorkflowOutput` renderer. It adds no server route, capability, server
persistence, filesystem writer, or provider adapter requirement. Automatic
skill-metadata activation, whole-history prefix snapshots, correlated async
wait handles, and a collapsible/reordered outline remain future work.
The direct skill-file metadata requirement is tracked in
[skill metadata activation](../gaps/workflow-skill-metadata-activation.md).
The single `tagged-stages/1` prototype now implements `closed` matching and
additive whitelists without a version bump. Schema loading also validates and
retains `presentation.collect` (Boolean, default false) and
`presentation.order` (finite number, default zero). These fields do not inherit
and do not reorder the current linear display. A collecting renderer remains
unimplemented; its contract is defined by the shared producer specification.

## Design decisions

- **Use the existing raw-file API for explicit file references.** This keeps
  server-side path authorization and source routing in their existing owners.
  Stable releases v0.8.0 and v0.8.1 already provide the route, conditional GET,
  and relay ETag forwarding; the client exposes the existing response metadata
  without changing the wire protocol. Embedded declarations retain their own
  content, while external files use the five-minute conditional cache.
- **Keep boundaries inside existing rows** (vs. splitting turns/tools): this
  preserves source identity, chronology, inspection, and existing activity
  controls while making stage changes visible.

## Verification

`packages/client/test-fixtures/workflow.ts` contains a neutered publish trace
with the local skill's declaration, stage prefixes, and opaque publisher
output. Its executable operations only run Node to write fixed stdout;
they never invoke the publisher, Git, or a network client. A separate inline
trace includes a tool whose output arrives after the agent changes stages.
Nested script traces cover inherited policies, self-announced inline tags
under an opaque parent, and a mid-output change from `matching-lines` to
inline spans. Each verifies the assistant can continue and explicitly finish
the outer workflow after the script returns.
Code-mode variants wrap these outputs in the observed typed-text,
single-command, and fulfilled-result forms. Tests also isolate sibling result
boundaries and reject activation hidden in arbitrary JSON or fenced examples.

`workflowProjection.test.ts` exercises both through the production transcript
projection, plus default-off behavior, exact matching, malformed/quoted
markers, streaming lines, lifecycle, inherited tool context, and reload.
`e2e/workflow-tags.spec.ts` loads simulated persisted sessions through the real
server and browser, toggles the Appearance setting, checks both views and
original output, and captures desktop/phone layouts. The file-only fixture's
decoded tool stdout contains just the announcement: the schema exists separately as
an actual JSON file on desktop and fenced Markdown file on phone. Both browser
traces use code-mode envelopes, including a fulfilled result on phone. The browser
test observes the real raw response, verifies no read before enabling the
setting or within the TTL, then advances the client cache clock to exercise
an unchanged `304` and a changed file's `200` and new labels. Inline and nested
traces require no file requests. `workflowSchemaFiles.test.ts` also covers
assistant announcements, source isolation, failure expiry, and cancellation;
transport tests preserve conditional status and ETags over HTTP and relay.
These are simulated producer traces, not evidence that a live model reliably
follows the skill. Native browser/file integration was exercised on Linux;
Windows and macOS host reads remain unexercised here. Portable path tests cover
drive-qualified, UNC, home-relative, and literal bracket/space references.

## Purpose and scope

A multistep skill can describe both how the agent should work and how its work
should be presented. For example, a review can expose an outline whose entries
collect progress, findings, and links to the relevant searches and checks:

```text
Review changes                                      in progress
  Inspect affected paths                            completed
    Outcome: two call sites need checking
  Check behavior                                    in progress
    Exercise normal inputs                          completed
    Exercise cancellation                           in progress
  Report findings                                   pending
```

Collapsing a branch or focusing on cancellation reveals the associated
activities without losing the overall outline. These are viewing operations.
Version one has no answer fields, approvals, editable checkboxes, or controls
that instruct the agent to skip, retry, or reorder work. It does not extend the
workflow into another turn. A later version may do both.

The workflow is a shared rendering context across several harness activities.
Its **schema** defines the permitted structure and meanings; a **declaration**
supplies the particular parts, labels, and initial state. A formal skill or
ordinary instructions can supply both, including when to emit updates. Merely
providing a JSON Schema does not identify the actual work or report progress.

An **artifact** is an output of the work: a report, chart, comparison, or other
content with an appropriate viewer. A workflow part can link to artifacts and
transcript activities. The workflow structure does not prescribe a new general
rich-output format. Existing Markdown, media, file, and tool renderers remain
useful independently of workflow grouping.

## Published precedents

Sources checked 2026-09-07. This is a bounded review of documented contracts and
local YA integration points, not a runtime compatibility test. Product help,
provider event schemas, and interoperability protocols have different scope.

| Surface and source | Documented contract | What informs this proposal |
| --- | --- | --- |
| [Claude chat/Desktop artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) — product documentation | A dedicated artifact view alongside conversation, multiple artifacts, revision selection, source inspection, and download. | A work product can have identity and a viewing context separate from individual chat messages. The reviewed help does not specify a reusable workflow hierarchy or activity-association schema. |
| [Claude Code artifacts](https://code.claude.com/docs/en/artifacts) — tool behavior documentation | The `Artifact` tool publishes an HTML or Markdown file; changing the file and republishing updates the artifact at the same URL. A later session can attach an existing artifact. | A terminal-driven session can maintain a browser-viewable analysis result. This documents artifact publication and continuity, not a general workflow event format. |
| [Cowork artifacts](https://support.claude.com/en/articles/14729249-use-artifacts-in-claude-cowork) — product documentation | The account-backed system introduced August 19, 2026 supports versioned artifacts; existing links can be used to update them from another session. Earlier live artifacts have separate legacy behavior. | Artifact lifetime can exceed a turn or session. Keep that lifetime separate from the initial single-turn workflow span. |
| [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) — provider schemas | Planning tools expose task IDs, status, descriptions, and dependency updates (`addBlocks` / `addBlockedBy`). Runtime task-start/progress messages separately carry `task_id` and optional `tool_use_id`; forwarded subagent messages can identify a parent tool call. | Task identity, dependency, and execution correlation are useful ingredients. Planning task IDs and runtime task IDs belong to distinct contracts; neither alone supplies the proposed rendering context. |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) — provider protocol | `turn/plan/updated` contains thread and turn IDs, optional explanation, and entries with `step` and `status`. Tool activities have item lifecycle IDs. The separate `plan` item carries plan text. | YA can associate a checklist with a turn. The checked checklist schema has no stable per-step ID, hierarchy, or explicit step-to-tool association. |
| [Agent Client Protocol (ACP) plans](https://agentclientprotocol.com/protocol/v1/agent-plan) and [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls) — protocol specifications | Plan notifications carry complete replacement entry lists with content, priority, and status. Tool calls have stable session-local `toolCallId` values and incremental updates. | Full snapshots are a simple baseline. The plan entry contract does not require stable node IDs or nesting; tool-call identity provides a separate possible association target. |
| [Agent User Interaction Protocol (AG-UI) events](https://docs.ag-ui.com/concepts/events) — protocol documentation | Run/step lifecycle events coexist with `ActivitySnapshot` and `ActivityDelta`. An activity has a `messageId`, an activity-type discriminator, and structured content; deltas use JSON Patch. | Closest structural precedent in this review: an identified activity view can evolve between chat messages. The domain-specific workflow hierarchy still needs a payload contract. |
| [Model Context Protocol (MCP) Apps](https://modelcontextprotocol.io/extensions/apps/overview) — extension overview | Hosts such as Claude Desktop can render tool-provided HTML interfaces in sandboxed frames and mediate communication with tools. | Relevant to an artifact's viewer and eventual interaction. Adopting an app container would not by itself define workflow membership, outline state, or transcript grouping. |

Claude's [task-tool availability](https://code.claude.com/docs/en/tools-reference#task-tool-availability)
varies with model, context, and configuration. A skill cannot assume a native
task tool is always present. This also separates a documented capability from
the capabilities available in a particular running session.

The resulting design inference is to borrow identified activity state and
snapshot semantics while keeping the transport replaceable. None of the
reviewed contracts supplies the entire skill declaration, nested progress,
artifact association, and transcript projection described here. That is a
finding about this source set, not a claim that no such system exists.

## Session-first production

The baseline producer is the calling agent session. Instructions teach it to
choose a workflow ID, emit the declaration, and report meaningful changes
under that ID. YA recognizes a versioned structured block in the session's
output and binds it to the observed session, turn, and source message. Ordinary
unbuffered stdout from an invoked tool is another possible carrier when that
tool is explicitly designated as a workflow producer.

No new callback broker, MCP server, or persistent process is required for this
display contract. A CLI can query a daemon or attach to an existing interaction
and emit the same data. Selecting a carrier should follow what the harness
preserves and the model produces reliably. The initial tag convention below
uses ordinary output and adds no CLI.

Native harness metadata can later carry the same logical records and improve
association with tool calls. Keep that as an adapter capability. The agent
does not need to know provider-assigned message or tool IDs to show an outline.

YA supplies identity boundaries: for v1, the effective key is the canonical YA
session ID, observed turn identity, and producer's workflow ID. Provider IDs
remain namespaced references. An identical workflow ID in another turn does
not implicitly continue this instance. Markers carry display data and do not
become user messages, approval, or authority over another session.

## Initial tag convention

The reusable `tagged-stages/1` contract is owned by
`~/agents/topics/workflow-tags.md` and adopted by this checkout's local publish
instructions. A one-line `@@visualization-schema/1 <schema-path>` activation,
or the quick inline list described below, must first be surfaced in agent output
or a tool result. A resolved invocation
or observed read of skill content can instead activate through the string-valued
`metadata.visualization-schema`
frontmatter field. Skill discovery and ordinary bracketed text do not activate
the view. The declaration's `type` selects from a fixed supported inventory,
initially `tagged-stages/1`, leaving room for explicitly added visualization
types besides tag-based outlines.

Quickly authored output can instead use
`@@visualization-schema/1 ["build","test","report"]`. The JSON list is distinct
from an absolute or home-relative path and needs no schema file. Its atoms
whitelist exact assistant/tool prefixes, titles default to the atoms, and tool
output uses spans beneath its calling context. A nested array entry denotes an
exact multi-key path. This generic preset starts at activation and ends at the
next activation or turn boundary without claiming workflow completion. File
schemas remain available for richer structure, titles, policy, and outcomes.

Fixed `[A][B]` line prefixes select paths in an outline; declared
titles expand shorthand keys, with the key itself as fallback. Following agent
activity belongs to that path until the next recognized prefix.

The schema can describe substeps inside one tool invocation and explicitly
enable tool-output tags. Open matching accepts every start-of-line bracketed
path. Closed matching accepts declared descendants plus exact whitelist
entries; an omitted or empty whitelist adds nothing. Tool paths inherit
the calling stage as their parent. A tool view can either show matching lines
only in its compact presentation or split the full output into spans ending
at the next match. Both retain the original output in detail view.

The current local publish script remains opaque to this convention until it
emits compatible prefixes. Declaring its children does not claim that their
progress is observable. This producer convention can precede YA UI support.

## Resolving skill and schema sources

The shared topic owns the pointer grammar and metadata field. In YA, file reads
run on the connected server through its raw-file route; the client parses the
returned declaration. Standalone references are absolute or `~/`-relative;
`~` is that session owner's home. A relative schema reference inside skill
metadata is relative to the real source skill file. YA does not implicitly
search `~/agents` for an unbased path. An explicit reference such as
`~/ya/topics/publish-workflow.local.md#ya-publish/1` selects the declaration by ID.

There is already a concrete path source for Codex: `refreshCodexSkills` retains
the `skills/list` metadata, and `createCodexUserInputs` in
`packages/server/src/sdk/providers/codex.ts` sends selected skills with their
provider-reported paths. The shared `SlashCommandInvocation` menu metadata
does not currently carry a skill-definition path. A future activation resolver
should use the retained server-side inventory and invocation, or an observed
file-read path when native provenance is absent. An explicit schema path can
activate without resolving a skill file.
It should not infer a filesystem location from a skill name.

Follow [skill invocation](skill-invocation.md): definition paths remain
server-side unless already exposed as supported provenance. Deliver the resolved
declaration and activity/turn binding to the renderer, and preserve that snapshot
for replay. This automatic skill-metadata reader and activation resolver are
proposed work;
existing skill dispatch does not establish that they are implemented.

Both tool and assistant activities can explicitly select a supported
visualization type, including an automatically selected skill. Such records
retain their originating activity as well as the containing turn. Adding a
different visualization type should extend the fixed dispatch inventory, rather
than relying on tag-shaped prose or requiring every type to be an outline.

## Visualization progression

The implemented v1 highlights matching prefixes and adds visual
pseudo-boundaries inside the existing turn/tool presentation after schema
activation. The original producer proposal calls this the v0 prototype.
A later collapsible linear outline would retain segment chronology:
`[A]`, `[B]`, `[A]` still produces three segments.

A later collecting view gathers both A segments only with `collect: true` and
matching parent/producer context. `collect: false` preserves separate
instances. Siblings sort by `order` (omitted equals zero), then declaration
order; undeclared zero-order paths follow declared zero-order siblings in
first-appearance order. Separate parents and distinct tool invocations retain
their boundaries. Source links and within-stage chronology survive, and the
original linear display stays available. The same prototype schema and paths
serve both views; adding these fields does not implement that renderer.

## Candidate richer declaration and updates

The following is an illustrative complete snapshot, not a released schema or
an invocation recipe. It shows the information that a skill and YA would share:

```json
{
  "format": "workflow-view/1",
  "workflowId": "review-7",
  "schemaId": "review/1",
  "revision": 2,
  "title": "Review changes",
  "status": "in_progress",
  "parts": [
    {
      "id": "inspect",
      "label": "Inspect affected paths",
      "status": "completed",
      "outcome": "Two call sites need checking"
    },
    {
      "id": "check",
      "label": "Check behavior",
      "status": "in_progress"
    },
    {
      "id": "cancel",
      "parentId": "check",
      "label": "Exercise cancellation",
      "status": "in_progress"
    },
    {
      "id": "report",
      "label": "Report findings",
      "status": "pending"
    }
  ]
}
```

The format version defines the common envelope. The schema identity describes
the workflow kind and any domain-specific outcome fields. Every snapshot
contains enough labels, hierarchy, and generic status to render the outline
without fetching that schema from an arbitrary URL or scanning project files.
A skill can include a declaration alongside its instructions, and a tool can
document the same contract through its normal self-description.

Stable part IDs preserve expansion and focus across revisions. Parent links
form an acyclic outline, and array order supplies sibling order. Dependency
edges are a separate future concern: something can depend on another part
without belonging beneath it. An initial status vocabulary could be pending,
in progress, completed, failed, blocked, and skipped. Outcomes explain what was
learned; completion of a review can include findings that identify defects.

Start with complete replacement snapshots at useful boundaries: declaration,
change of active part, material result, and conclusion. A producer need not
emit updates for every tool output or incur an extra model round for each
marker. Incremental patches can wait until an observed size or update pattern
justifies their replay and resynchronization complexity.

## Activity and artifact association

An outline is useful with no fine-grained activity mapping. Activities can stay
in their ordinary turn view while the outline reports part states and outcomes.
Where supported, a part may additionally carry explicit references to observed
messages, tool calls, or artifacts. A producer-chosen activity key is useful
only if it also appears on the relevant activity in a carrier YA can observe;
an invented provider tool ID is not a substitute.

A declared tag-span convention explicitly assigns presentation groups by
prefix, with each tool invocation retaining its captured parent stage. Without
such a convention, proximity to a marker does not establish a unique part
assignment: concurrent work and several active parts make that ambiguous.
Semantic associations can separately be many-to-many, since one check may
support two parts. Unknown references remain unresolved and inspectable.

Artifact references identify outputs and, when the underlying artifact system
supports them, particular revisions. A mutable URL alone cannot reproduce an
earlier version; the UI should not present it as frozen historical evidence.
Inline rich content uses the existing approved renderer for that content type.
The workflow envelope itself contains data, with no executable renderer code.

### Nice to have: follow asynchronous tool output

A background command should keep contributing output and its terminal result
to the workflow region where it was launched. For example, a Pages publisher
started under `[publish][client]` may return a running handle, then produce
output through later wait calls or task notifications. Those records should
remain under the captured client stage even if the agent advances elsewhere.

Where the harness exposes the association, retain the original invocation's
workflow, stage, schema policy, and returned task/session handle. Follow that
operation across output chunks, waits, and completion events without treating
each observer call as a new publisher. Apply enabled tool tags with the same
invocation-local cursor across chunks; the observer's current stage must not
replace the captured parent. Keep source links and chronology, and deduplicate
replayed output by source identity or stream position rather than text equality.
Identical log lines can be distinct output.

Show the operation as running until its terminal status arrives; launch
acknowledgment or silence does not establish completion. An unknown handle
stays visible in the ordinary transcript rather than being assigned by timing.
When the adapter cannot correlate output, the session can retain the handle
and report results under the original stage using the existing text convention.

This is an optional presentation improvement, not a new scheduler or a reason
to delay the initial outline. Its first scope is output consumed within the
same turn. Following jobs into later turns requires the explicit cross-turn
continuity extension below; late output must not silently reopen a closed span.

## Projection, replay, and lifecycle

The workflow outline is a projection over the conversation. Canonical messages,
chronological order, tool results, and anchors remain intact. Grouping should
compose with [conversation view](conversation-view.md), retain access to the
original transcript, and leave unassociated activities visible. A user can
inspect the source update that caused a displayed state.

For a full declaration, the opening starts the span inside the observed turn.
An explicit terminal record closes it: an end marker for tags, a final snapshot for the
richer candidate. Ending or canceling the turn without closure leaves the
workflow incomplete or interrupted; it does not mark pending parts completed.
A completed command does not prove completion
of its containing part. A tool error does not by itself fail the entire
workflow. The displayed part result is the producer's report, with linked
evidence available for inspection.

The quick inline form instead has a display-only span bounded by activation
and the turn, with no task-completion assertion to infer from its end.

Replaying the same source records should yield the same outline as live
updates. Deduplicate by source identity and retain the last accepted state
when an update is incomplete or malformed. Snapshot producers use validated
revisions; conflicting duplicate revisions remain inspectable. A tail load
needs resolved state at its boundary, including the active tag paths and
declaration or the latest complete snapshot, so labels and ancestry survive
off-window source records.

Parse only designated structured output envelopes, including explicitly
selected producer results. Quoted examples, file contents, logs, and arbitrary
nested JSON are not independent workflow declarations. Enabled tool-output
tags use their declared matching policy, including unrestricted start-of-line
matching when `closed` is false or omitted. Unknown envelope versions or
invalid hierarchy retain their ordinary readable output. A known generic
envelope with an unknown domain schema can still show its basic outline.

## Existing YA footholds and boundaries

YA already reconstructs task state across Claude tool events:
`createTaskListAugmenter` and `projectTaskListSnapshots` in
`packages/server/src/augments/task-list-augments.ts` produce `_taskSnapshot`;
the session route projects before slicing history, and the stream augmenter
uses the same fold. `TaskListRenderer.tsx` renders snapshots through registered
`TaskCreate` and `TaskUpdate` renderers. See
[task-list rendering](task-list-rendering.md). This verifies an existing state
reconstruction pattern, not support for the workflow envelope above.

Keep normalization and grouping at the shared transcript/render boundary,
following [UI architecture](ui-architecture.md). The implementation location
should follow live/reload parity and history-slicing requirements; a public
portable transcript protocol is not a prerequisite. A novel workflow view
would be configurable and initially default-off under
[vanilla defaults](vanilla-defaults.md).

[Interactives](interactives.md) concerns richer app hosting and isolation;
[rich interviews](rich-interviews.md) banks structured user-input workflows.
Both are separate proposals. This topic neither activates them nor makes
their implementation necessary for an outline of agent work.

## Acceptance for the later outline

These are proposed outline acceptance cases, beyond the verified v1 boundary
and tag-highlighting contract above:

- One skill-led turn containing several agent messages and tool calls produces
  a coherent nested outline using only session-authored workflow IDs.
- Collapse and focus survive valid updates; each result and associated
  activity remains reachable in the original transcript.
- Calls under a tag-span convention retain their captured parent; otherwise
  concurrent calls without explicit references remain unassigned. Associations
  preserve the underlying chronology.
- Cancellation, malformed partial output, duplicate delivery, and reload do
  not invent completion or silently lose the last valid state.
- A tail-loaded view can recover the current outline; unsupported viewers
  retain useful ordinary text or structured output.
- The producer instructions are short enough to use in a real skill, and the
  chosen output carrier survives both live streaming and saved history in
  Claude and Codex. Their end-to-end reliability remains untested here.

The next implementation question is whether the initial tag convention
survives those harnesses reliably enough to render useful outlines. Helpers,
native adapters, and richer transports remain optional; none is scheduled by
this proposal.

## Later extensions

Cross-turn continuity could explicitly bind later turns to a persistent
workflow ID. The session can report that ID on continuation; native harness
support would make active-workflow detection more reliable. Branching and
resumed sessions need deliberate ownership and continuation rules before an
ID can group them. Do not infer continuation merely from similar task labels.

With that contract, a workflow-focused view could nest turns and their
agent/tool/user dialogue under parts, or order the view by workflow structure
while preserving each source turn and chronological transcript. Dependency
graphs could supplement the outline. Structured user answers and controls that
change execution would be a further interaction contract, outside v1.

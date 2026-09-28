# Clair: session awareness across shared and isolated checkouts

Status: ideas-only candidate presently; implementation not authorized.

The user places Clair in the ideas-only category given its small adoption
signal and lack of recent pushes. GitHub metadata checked 2026-09-26 reports
7 stars and last push 2026-07-09. Those are maturity/activity signals, not
evidence against the mechanism. Historical code and live Git artifacts make
it a concrete design reference, without establishing production readiness.

## Aim

Explore [Clair](https://github.com/JBJamesBrownJB/clair)'s Git-backed awareness
model as a possible successor to the personal `agentctl active` registry and
as an early coordination layer for long-running work in separate checkouts.
Preserve the shared-worktree preference: isolation is useful only if agents
can notice incompatible plans before integration, and reliably bring finished
work home. Lower spurious interference matters as much as detecting overlap.

The primary local project checkout could serve as a rendezvous for sibling
checkouts; a GitHub remote is an optional later transport. YA would own
provider-neutral integration rather than require Claude hooks. This proposal
does not change workstream defaults or promote the workstreams experiment.

Team-built repositories are an explicit target, not just a future extension of
one person's parallel agents. The user also identifies multiple YA servers,
multiple human users on one YA server, and multiple users across separate YA
servers working on the same project. Reusing their Git remote could supply a
common awareness channel without deploying another coordination service.
Transport efficiency remains a hypothesis to measure, but this distributed
reach is a distinct reason to consider Git even if local registry replacement
proves unnecessary.

## Source checkpoint

Inspected Clair default-branch revision
[`f97df841f749cd26a2cec7111189886dae8815a8`](https://github.com/JBJamesBrownJB/clair/tree/f97df841f749cd26a2cec7111189886dae8815a8)
on 2026-09-26, then refreshed the clone and inspected remote refs and history
after the user challenged the main-only assessment. This is source/artifact
inspection, not a runtime evaluation.

- Current [`plugin/README.md`](https://github.com/JBJamesBrownJB/clair/blob/f97df841f749cd26a2cec7111189886dae8815a8/plugin/README.md)
  explicitly says no commands, hooks, or MCP server are wired. The CLI prints
  a skeleton greeting; `clair-core` contains a placeholder test. It is not
  currently an integration-ready Claude plugin on `main`. This is an
  intentional reset, not evidence that the mechanism was never implemented.
- The [archive notice](https://github.com/JBJamesBrownJB/clair/blob/f97df841f749cd26a2cec7111189886dae8815a8/docs/archive/README.md)
  identifies the old same-branch pairing implementation and its hook/MCP
  architecture as pre-reset provenance. Archived diagrams labelled SHIPPED
  do not describe the current tree. The
  [reset commit `a3eff5f`](https://github.com/JBJamesBrownJB/clair/commit/a3eff5fee3aed6a39c4885002f5ede6f69f16aaf)
  explicitly removes the old implementation to rebuild around repo-level
  awareness, preserving the implementation in history.
- The current [data-model draft](https://github.com/JBJamesBrownJB/clair/blob/f97df841f749cd26a2cec7111189886dae8815a8/docs/architecture/data-model.md)
  proposes a latest-presence register per session plus expiring decision,
  incident, and finding events. Cheap headlines/path facets precede details.
  Branch and worktree are attributes, not session identity.
- Linked Git worktrees share the proposed shadow ref namespace. Independent
  clones require explicit exchange. The draft leaves transport/ref layout,
  pruning ownership, and shared-checkout per-session cursors unresolved.
- Collision detection is proposed as a consumer-derived view over presence
  and committed/pushed diffs. It is not a pre-write exclusion mechanism, and
  it cannot by itself attribute shared dirty-tree changes to their writers.

### Implementation and artifacts beyond main

- Pre-reset [revision `9282295`](https://github.com/JBJamesBrownJB/clair/tree/92822956271f0e880d91f9a4365f453c71e97bee)
  contains the Rust core, CLI, MCP server, Claude prompt/stop hooks, and
  unit/BDD/integration test sources. This is substantive proof-of-concept code,
  not just archived design prose. Tests were not rerun during this inspection.
- Its `crates/clair-core/src/git.rs`, especially `Repo::append_lines`,
  implements the transport: fetch a shadow branch; append to `log.jsonl`;
  create blob/tree/commit with `hash-object`, `mktree`, and `commit-tree`;
  push the commit SHA to `refs/heads/clair/...`. The first commit has no
  parent; subsequent messages extend that separate history. Non-fast-forward
  rejection triggers bounded fetch/reappend/retry. Message writes avoid the
  working index/HEAD; the separate old pairing command does switch branches,
  so the whole historical plugin is not suitable unchanged here.
- Remote `clair/main` at `2c6df73d8b294573b021e56948d8a09942ead639`
  contains a `log.jsonl` tree and 317 commits descending from an orphan root.
  `clair/ready` and multiple `clair/run/...` refs also remain. These are actual
  persisted bus artifacts, not merely proposed ref names; message contents
  need not be copied into this sketch.
- `feat/benchmark-runner` at
  [`c27c5d6`](https://github.com/JBJamesBrownJB/clair/tree/c27c5d62b786fe44b097ecdf2c61e90158fae251)
  contains a TypeScript multi-agent benchmark runner, tests, and saved results;
  `arena/base` and `arena/reference` hold the benchmark application. Its July 1
  handoff reports CI provisioning failures and explicitly defers a valid
  awareness-on/off comparison. That is author-reported experiment status,
  not reproduced effectiveness evidence.

The first assessment stopped at the default-branch snapshot and therefore
understated the available implementation evidence. The corrected disposition
is an ideas-only adoption candidate with an inspectable historical transport
prototype and surviving message refs. Evaluate that prototype before designing
a replacement bus from scratch; do not mistake it for the newer awareness
model being complete or for measured superiority to a local registry.

### Shared experiment conclusion and public coverage

Read the actual append log on `clair/feat/benchmark-runner` at
[`b32fa19`](https://github.com/JBJamesBrownJB/clair/blob/b32fa19831631a7e68338a1bbdede6bb079fef0d/log.jsonl):
102 prompt records and 103 summary records, including subagent notifications
among the prompts. Its June 30 discussion expands the question from whether
independent changes collide to **total cost of successfully integrating all
the work**, including a repair agent. Short summary records frequently retain
only the final conversational sentence, so the saved result files and July 1
handoff are necessary cross-checks rather than treating this as a full transcript.

The shared result is an unfinished measurement effort:

- The resolver could report local success while the held-out acceptance gate
  failed. The saved `standard-L1-resolver-armA` result has
  `resolution.reachedGreen: true` but `outcome: fail` and
  `gate.allPass: false`. The log discusses a dropped branch and introduces
  per-branch merge/test checks and test-integrity guards to prevent false
  success. This motivated a benchmark redesign, not a demonstrated rejection
  of awareness.
- The latest saved PR-queue Arm-A run marks all three branches blocked by
  `ci-fail` and the run incomplete. The log and final handoff attribute this
  to incomplete worktree dependency installation; they report a separate
  manual S1 checkout passing typecheck and 33 tests. That manual result is
  reported, not independently reproduced here. The JSON's `envError: false`
  shows why the aggregate label alone cannot establish an agent failure.
- The final recorded next step is fixing provisioning and rerunning, followed
  by a valid awareness-on/off comparison. The final human prompt asks to
  record state before shutting down; it does not announce abandonment or a
  private successor. No valid completed on/off result was found in the
  inspected public artifacts.

Public inspection covered all 22 advertised branch heads, no advertised tags,
all four PRs (merged), the one open issue (arena tag publication), and empty
release/fork listings on 2026-09-26. Main is incomplete as an inventory of the
repository's work: the runner and arena are deliberately elsewhere. The
public refs examined do not reveal a completed post-reset awareness product.
The June 26 reset also predates the June 30 experiments, so those experiments
cannot explain that reset. A later private or employer-owned development line
is possible but unsupported by this public evidence.

The originating [interview](https://www.youtube.com/watch?v=JCPrxKse4YQ) is
human context only; neither video nor transcript was retrieved.

## Related projects and successor search

Checked 2026-09-26. The clone confirms the user's freshness observation:
the newest of all 22 advertised branch tips is main on July 9; the runner
and its append log end July 1, and the other experiment logs end June 30.
History supplies more implementation evidence, not newer development.

Three independently authored projects provide relevant public comparisons.
No Clair citation or derivation was found in the inspected sources. These
are source/documentation findings, not runtime or reliability evaluations.

| Project | Mechanism and relevance | Activity observed |
| --- | --- | --- |
| [Confer](https://github.com/codeshrew/confer) | Dedicated Git hub for message commits; signed orphan commits under per-role presence refs. Separate agent clones, local trust/cursors, polling/watch, task projection and dashboard. Its [design](https://github.com/codeshrew/confer/blob/main/DESIGN.md) is particularly relevant to multiple hosts and humans. | Created July 14; [v0.8.38](https://github.com/codeshrew/confer/releases/tag/v0.8.38) published September 26; one star. |
| [Armature](https://github.com/scullxbones/armature) | [Architecture](https://github.com/scullxbones/armature/blob/main/docs/design/architecture.md) separates an `_armature` orphan branch and operations worktree from source. Per-worker append logs carry claims, heartbeats, notes and task transitions. Broader task orchestration than proximity awareness. | Last push September 26; one star. |
| [Leat](https://github.com/justinstimatze/leat) | Git message bus with per-author JSONL lanes, direct/channel messages and local cursors. Source retries push after pull/rebase. An orphan ref is not a documented requirement; it cites mcp-dispatch's transport contract rather than Clair. | Last push September 10; zero stars. |

Confer's inspected checkout is `0ef6ae172ee8ef78e5b3c2a525a863fce2e0a057`.
It documents Claude and Grok reactive adapters and Codex polling. This makes
it a useful next implementation to inspect for provider-neutral exchange,
not an adoption recommendation. Its pre-1.0 formats and small public adoption
signal leave maturity unestablished. Per-writer files avoid some content
conflicts; they do not eliminate shared branch-tip contention. None of these
sources establishes better local efficiency than registry files.

Plugin discovery did not find Clair or a newer distribution:

- The independent [claude-plugins.dev search API](https://claude-plugins.dev/api/plugins?q=clair)
  returned five unrelated name/description matches. Author queries for
  `JBJamesBrownJB` and `James Brown` returned zero. Its automatic public-GitHub
  indexing is not an exhaustive inventory of unpublished or unindexed plugins.
- The complete current claudemarketplaces.com core and two plugin sitemaps
  contained no relevant author or Clair listing. The similarly named
  [Waypoint Claire](https://claudemarketplaces.com/plugins/poindexter12-waypoint/claire)
  is unrelated component-authoring tooling.
- Anthropic's [official directory manifest](https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json)
  contained neither Clair nor James. Other false leads included Cody Bromley's
  Clairvoyance design-guidance plugin and Aaron Maturen's clair-de-config.

The public successor search covered the author's 18 public repositories,
public organization membership, author/repository/code searches, self-linked
CV and Medium feed, and company-name organization searches. No linked second
account or public Clair v2 was found. The [CV](https://github.com/JBJamesBrownJB/cv)
mentions Speciate, an artificial-life sandbox, not a coordination successor;
its repository link returned 404, which cannot distinguish deletion from
private visibility. Public company-name searches cannot settle private work.

The August 12 [publisher-supplied episode description](https://podcasts.apple.com/ie/podcast/the-enterprise-ai-gap-with-james-brown/id1687271887?i=1000782967095)
still links the original Clair repository. Only the description was retrieved,
not the video or transcript. This is evidence of the public pointer remaining
unchanged, not evidence that development continued. A private/employer-owned
successor remains possible; the search supplies no affirmative evidence for it.

## Assessment of replacing the registry

The useful idea is selective, session-aware disclosure of relevant work.
Git transport is a separate choice. No measurement currently supports replacing
local text records with Git objects/refs for efficiency.

| Concern | Local registry today | What the Clair direction adds or leaves open |
| --- | --- | --- |
| Presence | Session gist, scope, freshness, completion | Automatic activity and relevance filtering could reduce manual updates and context reading. |
| Edit coordination | Advisory per-path claims and project-wide solitude checks | An awareness event does not preserve claim clearance or rewrite exclusion semantics. |
| Separate checkouts | Registry is rooted in the working project directory | A repository-wide rendezvous can connect isolated work without sharing dirty files. |
| Transport cost | Local file reads/writes and scans | Git adds object/ref operations; remote exchange adds latency and credentials. Costs need measurement. |
| Lower interference | Broad scopes can block unrelated edits | Distinguishing intent, observed edits, and concrete overlap may reduce noise regardless of storage. |

The personal `agents/topics/agentctl.md` contract defines claims as advisory,
with an observe-then-claim race; it does not promise a mutex. A replacement
must nevertheless account for its existing DONE/staleness, exact/covering
claims, waiting notices, and REWRITE behavior. Replacing only active records
must not accidentally remove unrelated run management or steward state.

For shared-worktree use, a common Git diff cannot identify who changed what.
Presence should retain explicit planned scope and observed successful edits
per session. Narrow claims still protect immediate writes; asynchronous
merge-risk notices are insufficient. Hunk disjointness also does not prove
semantic independence: different files can implement conflicting contracts.

## YA baseline and existing owners

Inspected YA at `3eadaebd079947dafd9a51cb2e0b257179414c22`.

- [Workstreams](../../topics/workstreams.md) and
  [tactical 054](../../docs/tactical/054-workstreams.md) already own parallel
  topic work. A lane is an ordinary local clone, with a canonical main
  checkout. Multiple clones may all be on `main`, so branch name alone
  cannot identify a lane or an agent.
- Current `WorkstreamsPage.tsx` (`WorkstreamsTable`/`WorkstreamsRow`) renders
  lane, kind, branch, queue pause state, status, and path; session counts are
  placeholders. `routes/workstreams.ts` exposes gated listing, checkout
  preview, and creation; `WorkstreamService` creates ordinary local clones.
  This is a partial lane view, not a live cross-branch conflict/landing graph.
  Lane queue targeting, scheduling, sync, and landing remain pending in the
  tactical. Metadata rendered in a row is not proof of a fresh Git observation.
- [Source Control](../../topics/source-control.md) already owns status,
  commit/file/diff/blame navigation and relevant-session links. Its
  **Dirty-file last editor** section and `DirtyFileEditorService` provide a
  provider-neutral seam: successful structured mutations can be attributed
  to canonical YA session ids. The retained record is only the last observed
  editor, not an edit history, intent record, or complete coverage of shell
  writes and external tools.
- [Fork with checkout](fork-with-worktree-checkpoint.md) preserves the
  maintainer concern about stranded work and faulty land-back. Awareness
  could help before divergence, but does not resolve that failure class.
- [Session worktree file links](../session-worktree-file-links.md) records
  viewer source-identity problems. Any eventual awareness link must open the
  exact checkout's file, not the same relative path in main.

This extends the existing workstreams direction rather than opening a second
lane-management implementation. It remains a later candidate under the
[roadmap](../../docs/roadmap/README.md#later-directions).

## Candidate design to test

The topology should support four cases without conflating them:

| Participants | Candidate rendezvous | Additional requirement |
| --- | --- | --- |
| One human, one YA server | Local app-data aggregation; optional project refs | Shared-checkout claims and separate session views. |
| One human, several YA servers | Explicit local/remote Git awareness exchange | Source-qualified session identity, offline freshness, deduplication. |
| Several humans, one YA server | One local coordination owner | Named principals and project-scoped visibility/action permissions. |
| Several humans, several YA servers | Existing team Git remote | Cross-server identity, explicit publication audience, bounded eventual delivery. |

Follow [Working Across Machines](../../topics/multi-machine-architecture.md)
and [Principals and grants](../../topics/principals-and-grants.md) for ownership
and authorization. Git access transports awareness; it does not establish a
YA user identity or authorize session steering. Clair's self-asserted display
identity is insufficient for that. Current YA operator access is not already
a multi-user project-membership system. Keep the awareness feature independent
of granting remote control, so a team can benefit before delegation exists.

1. **One identity model, separate coordination meanings.** Key records by
   repository identity, source/server, checkout, and canonical session id;
   retain the human principal separately. Attach
   branch/HEAD, declared intent, observed paths, freshness, and provenance.
   Keep presence, explicit edit claims, and inferred risk distinct. A stale
   observation means unknown, not safe; an idle session can still own
   unfinished branch work.
2. **YA as the common integration boundary.** Reuse session lifecycle and
   successful normalized edit observations, with explicit intent updates for
   planned changes. Provide a CLI/adapter path for sessions outside YA before
   claiming replacement coverage. Capability gaps remain visible; a provider
   that cannot receive a notice mid-turn must not be presented as notified.
   Do not infer full intent or authorship from dirty-file state.
3. **Local awareness first.** Compare app-data-backed YA state plus an
   `agentctl` compatibility view against Git-backed storage. Keep the current
   registry operational during an opt-in comparison. The local canonical
   project is the logical rendezvous; this does not require storing its state
   inside that project's Git directory.
4. **Optional Git transport.** If justified, isolate writers by session and
   use ref updates with expected-old values, bounded retries, expiry and
   deletion rules. Create orphan object histories through Git plumbing with
   an isolated index; never switch the user's checkout or reuse its index.
   Orphan means no ancestry to source history, not an empty message tree.
   Linked worktrees can see shared refs locally; lane clones need deliberate
   local exchange, even when their immutable object files began hardlinked.
   Do not push application branches merely to exchange awareness.
5. **Escalate useful evidence.** Start with path/intent overlap notices; use
   common-base-aware committed diffs for stronger merge-risk evidence. Separate
   these from dirty-edit warnings. Coalesce unchanged notices, bound retained
   detail, and avoid a receive/rebroadcast loop. Capture whether a notice
   changed a plan, caused coordination, or was dismissed as irrelevant.

Any Git-backed variant must obey
[project directory storage](../../topics/project-directory-storage.md): YA
may not silently create project-local refs/objects in App data only mode.
Project-local coordination and remote publication are distinct opt-ins.
Remote access exposes the chosen payload to that remote's readers; TTL is
reader expiry, not guaranteed erasure of Git objects. Peer-supplied intent is
attributed data, never executable instructions or authority to grant claims.

## Small discriminating evaluation before adoption

Use isolated fixtures, with runtime/profiling procedures selected before
benchmarking. Compare the existing registry, local YA aggregation, and an
orphan-ref prototype only if the first comparison leaves a transport need.

- Two sessions in one dirty checkout: distinct identity and intent, correct
  edit attribution where observable, independent read cursors, unchanged
  claim behavior, no lost status updates or index/HEAD mutation.
- Two linked worktrees and two ordinary lane clones: notice overlapping
  plans before merge, distinguish same branch names across clones, and show
  which inputs are unavailable or stale. Include renames and different bases.
- Concurrent writers, crash/restart, expired presence, idle unfinished work,
  and unavailable transport: no false clearance or unbounded polling/retries.
- Multiple servers/users: duplicate session labels, disconnected peers,
  delayed or reordered exchange, remote access revocation, and participants
  with different project permissions. Presence must not imply permission to
  read another user's transcript or steer their session.
- Disjoint hunks in one file, conflicting interfaces in different files,
  and deliberate shared work: measure both missed warnings and nuisance
  interruptions, not just detection of same-file edits.
- Measure subprocess count, local write/read work, ref/object growth, delivery
  latency, context tokens, time blocked unnecessarily, and actual plan changes.
  Lower operational cost and better coordination are separate outcomes.

Adopt a replacement only after demonstrating preserved local coordination and
useful cross-checkout awareness. If the awareness model helps while the Git bus
does not, retain the model with local storage. Reliable supervised landing is
still a separate workstreams prerequisite.

Opened 2026-09-26 from the user-requested Clair investigation.
Scope expanded by user direction on 2026-09-26 to team repositories and
multiple YA servers/human users, including same-server collaboration.
Contributing-model: gpt-6-astra

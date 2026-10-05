# Warp competitive analysis

Source review dated **2026-10-02**. Warp combines a terminal development
environment, remote supervision of local CLI agents, a hosted agent platform,
and an early-access software factory. The closest comparison to Yep Anywhere
is **Warp Terminal's universal agent support plus Remote Control**. Factories
adds a broader automation business around that directly competitive surface.

**Assessment: high competitive overlap.** Warp already addresses “run Claude
or Codex on my computer and check or steer it from my phone.” It also has
attention notifications, conversation forks, code review, cloud continuation,
and cross-harness orchestration. YA's strongest positioning is private remote
supervision, discovery of provider sessions created elsewhere, and a coherent
mobile session inbox on machines the user controls. Neither “multiple agents”
nor “fork conversations” explains the difference by itself.

## Scope and source snapshots

The following repositories were shallow-cloned under `~/github` and inspected.
Links in this review pin implementation and documentation to these commits.

| Repository | Inspected commit | Role |
| --- | --- | --- |
| [warpdotdev/warp][warp-tree] | `3f37d69ff3e87818d24f803c16b2e045fa4bd95e` | Rust desktop client, WASM viewer, Warp Agent driver, third-party harnesses, terminal and orchestration UI |
| [warpdotdev/docs][docs-tree] | `dbaf7ae2d45f714ce0585085b5708c19bfb6906a` | Official feature, billing, factory and security contracts |
| [warpdotdev/claude-code-warp][plugin-tree] | `8c28e936ae51cbb23a1a5657fca2bfd30cf06f12` | Claude notification hooks and Oz harness support |
| [warpdotdev/oz-agent-worker][worker-tree] | `19f897d934a898f04b8d30ae993d2e94b3e6fe18` | Self-hosted execution worker and backend lifecycle |

GitHub's API reported 65,341 stars and 5,605 forks for the main repo at review
time. These are repository attention metrics, not active users, paid seats,
or evidence that the newly exposed source generated that audience. The main
README identifies the **client** as open source: AGPL v3 for most of the tree,
MIT for `warpui_core` and `warpui`. The worker and Claude integration are MIT.
YA is MIT. [Main README][warp-readme], [worker license][worker-license],
[plugin license][plugin-license], [YA license](../../LICENSE).

This is a code-and-document review, not a runtime acceptance test. No Warp
build, account login, provider session, cloud task, or upstream test suite was
run. “Implemented” means found in the inspected source; “documented” means an
official contract describes it. Feature flags, plan gates and early access
can prevent source-present behavior from being available to a particular user.
YA comparisons use current topics and the [roadmap](../roadmap/README.md),
not the February feature matrix. YA HEAD observed during review was
`432e7beaba8408acfa64f79557c7476a309c24ad`; concurrent local changes were present.

## Attention and adoption evidence

The attention predates Factories. Warp launched its free macOS public beta on
2022-04-05, positioning itself as a redesigned terminal with editor-like input,
structured output and collaboration. That launch disclosed $23M in funding;
the company announced a further $50M Series B led by Sequoia on 2023-06-21.
An everyday developer-tool audience, an easily demonstrated UI and those
distribution resources are plausible reasons for visibility. This is an
explanation of potential reach, not attribution of each star or proof of usage.
[Terminal launch](https://www.warp.dev/blog/introducing-warp),
[Series B](https://www.warp.dev/blog/warp-drive-series-b).

GitHub reports that the repository was created on 2021-07-08. The client
open-source announcement is dated 2026-04-28 and names OpenAI as its founding
sponsor. Repository attention and forks therefore span a longer history than
the public client source. An oldest-first fork sample includes entries from
2021 and 2022; later sampled pages include a concentration around the April
2026 source release. These sampled creation dates do not measure active fork
maintenance or authenticate the accounts behind them.
[Repository API](https://api.github.com/repos/warpdotdev/warp),
[fork API](https://api.github.com/repos/warpdotdev/warp/forks?sort=oldest&per_page=100),
[open-source announcement](https://www.warp.dev/blog/warp-is-now-open-source).

The April announcement also claims nearly a million active developers. This is
**company-reported adoption**, with no activity window, deduplication method,
paid-seat count or independent verification supplied in that announcement.
It does not establish adoption of Remote Control, Oz or Factories.
[Company claim](https://www.warp.dev/blog/warp-is-now-open-source).

The maintainer subsequently supplied AI Engineer's **Software Engineering Is
Becoming Factory Engineering — Zach Lloyd, Warp**, uploaded 2026-09-27.
Its original English auto-generated captions at 1:11–1:18 distinguish three
claims: more than 60k GitHub stars, a few hundred contributors and more than
800k active developers using Warp. The video's own description also gives
800k; the recalled 200k figure is not the number in this passage. This verifies
what the captions and description report, not the underlying user count. The
talk does not define an activity window or provide an independently verifiable
usage dataset. It also does not establish that those developers use Factories.
[Talk and description](https://www.youtube.com/watch?v=tUPPVhBBcoM&t=71s).

Stars can be purchased or manipulated; published research documents fake-star
campaigns. This review found no evidence establishing that Warp purchased its
stars or forks, and it did not perform an account/network fraud audit. Attempts
to retrieve individual star timestamps returned no usable history through the
available API path. Aggregate counts are therefore a weak attention signal,
not evidence of authentic adoption. More useful validation would be defined
DAU/WAU/MAU, retention, paying teams, independent customer references and
sustained external contributions. The competitive assessment above rests on
the inspected capabilities rather than these popularity metrics.
[Fake-star research](https://www.kapravelos.com/publications/fakestars-icse26.pdf).

## Which Warp product maps to YA

| Surface | What it does | Competitive relationship |
| --- | --- | --- |
| Warp Terminal and universal agent support | Hosts ordinary third-party CLI agents; adds an input editor, status, notifications, Git context and review | Direct desktop agent-supervision competitor |
| Remote Control / Agent Session Sharing | Publishes local terminal and agent activity; browser/mobile viewers can receive execution rights | Closest match to YA's remote supervision use case |
| Warp Agent / Warp Agent CLI | Warp's own coding harness, available in the app and another terminal | Provider/runtime rather than a supervisor alone |
| Oz / Automation Platform | Runs and coordinates agents, stores run state and transcripts, supplies triggers, environments, APIs and team observability | Overlaps supervision and managed execution; substantially broader infrastructure |
| Warp Factories | Routes work through foreman, triage, spec, implement and review agents with evaluation and human handoff | Adjacent software-production workflow, built on the overlapping platform |
| `oz-agent-worker` | Executes centrally assigned tasks on customer infrastructure | Relevant to YA's execution-target direction; not an independently self-hosted control plane |

The main repository is the right place to study the wrapper/workbench. The
worker is the right place to study dispatch, isolation and host lifecycle.
Factory YAML and public API definitions describe configuration and integration
contracts; they do not establish that the hosted scheduler, factory service,
authorization service or databases can be run from these clones.
[README][warp-readme], [CLI support][cli-overview], [factory architecture][factory-infrastructure].

## Architecture and ownership

Three execution paths must stay separate:

```text
Ordinary local CLI
  Claude / Codex / another CLI -> Warp-owned terminal PTY
                              -> local status hooks, tabs and review

Published local CLI
  same local PTY -> Warp Session Sharing service -> browser / phone viewers
                 <- authorized prompts and PTY input <- remote viewers

Platform / factory run
  Warp control plane -> hosted sandbox OR customer oz-agent-worker
                     <- status, transcripts, artifacts and coordination
```

The first path is a terminal wrapper with provider-aware enhancements. It is
not equivalent to implementing fifteen structured provider adapters. The
second path keeps execution on the original machine while adding a hosted
control and publication service. The third path creates a separately managed
run with its own execution environment and platform identity.

The source reflects these boundaries. `CLIAgentSessionsModel` tracks a CLI
session by terminal-view identity and plugin events. Third-party driver runs
are explicitly **not** native `AIConversation` objects: the task-sync model
registers a terminal-to-task mapping to update the server. Warp's native
conversations instead persist tasks and metadata into its SQLite model and
can have server conversation tokens. [CLI session model][cli-sessions],
[task sync][task-sync], [conversation persistence][agent-persistence].

Warp Agent requests go through the authenticated multi-agent HTTP/SSE client.
Claude/Codex cloud harnesses run their provider tools and call their providers
directly with supplied credentials. Do not infer that every local third-party
CLI's inference passes through Warp simply because the platform's own agent
does. [Multi-agent client][multi-client], [harness authentication][harness-auth].

## Local CLI support and attention handling

### Agent breadth has several levels

The CLI-support page advertises fifteen named agents: Claude Code, Codex,
OpenCode, Amp, Auggie, Copilot CLI, Cursor CLI, Gemini CLI, Droid, Pi, Goose,
Antigravity, Hermes, Mistral Vibe and Grok Build. Source detection also contains
additional names such as OhMyPi and Kiro. This is broad terminal integration,
not fifteen equivalent notification, persistence, orchestration or cloud
implementations. [Support matrix][cli-overview], [detection][cli-detection].

Most receive rich input, review comments, file context, tab metadata and Remote
Control. Rich agent notifications are documented for Claude, Codex and
OpenCode. Published cloud harness identifiers are `oz`, `claude`, and `codex`;
Gemini is explicitly rejected by orchestration validation. Local child launch
source includes additional paths, but local Codex is product-gated by
`LocalClaudeCodexChildHarnesses`, and the child launcher accepts bash, zsh or
fish rather than PowerShell. Terminal platform availability therefore does
not prove the same local-orchestration coverage on every platform.
[Cloud harnesses][harness-overview], [validation][orchestration-validation],
[local readiness][local-harness-setup], [child launch][local-child-launch].

### Status is structured when the agent cooperates

The Claude plugin emits OSC 777 notifications with the `warp://cli-agent`
sentinel. The wire schema includes provider session ID, working directory,
prompt/response, tool name/input and transcript path. Warp parses events such
as prompt submission, permission request/reply, question, tool completion,
stop and failure, then maps them into running, blocked, success, failure or
cancellation state. This is real supervision metadata layered onto a PTY,
not just a screenshot of a terminal. [Plugin README][plugin-readme],
[wire schema][cli-protocol], [parser][cli-parser], [session state][cli-sessions].

The implementation deliberately distinguishes a real rich notification from
command detection and Codex's legacy OSC 9 fallback. `supports_rich_status`
becomes true only after a structured event arrives. The fallback cannot
establish trustworthy fine-grained blocking state. This is useful prior art
for exposing capability confidence rather than guessing from rendered text.
[Session state][cli-sessions], [event listener][cli-listener].

### Attention management is a meaningful shared feature

Warp has Complete, Request and Error notifications, native desktop alerts,
tab badges, and a mailbox with All tabs / Unread / Errors filters. Its
notification model subscribes to both native conversations and CLI status;
resuming work clears stale CLI notifications, and closing a CLI session
removes its mailbox entry. Source is guarded by notification feature flags.
[Notification contract][notifications-doc], [notification model][notifications-model].

YA's [Inbox](../../topics/inbox.md) remains different: it tiers sessions by
Needs Attention → Active → Recent → Unread across provider scanners, including
externally created histories, and can carry durable cross-session delivery
attention. Warp's desktop mailbox is primarily attention for its current
conversation/terminal surfaces. However, **Warp also has a Factory Inbox**
for questions, spec approvals, PR reviews, blocked runs and failures across
factories. That queue is personal to tasks the user started. YA should describe
the coverage and ordering of its inbox, rather than claim that competitors
lack an inbox. [Factory Inbox][factory-inbox].

Orchestrated child conversations are excluded from Warp's in-app toast/mailbox
stream; the parent gets the notifications, while child state is visible in the
pill bar or Sub-agents tab. A blocked child requires drilling into that child.
This reduces notification churn but can separate a human action from the
main attention queue. The documentation establishes the behavior; no claim
about actual missed approvals or usability failure was tested.
[Notification contract][notifications-doc].

## Remote Control is the closest direct competitor

### Remote viewing and steering are implemented

Remote Control publishes a running third-party session through a utility-bar
chip. The local agent continues on its original machine; another device opens
the share link. The feature is built on Agent Session Sharing, with live
output and optional execution rights. [Remote Control][remote-control-doc].

The code confirms the operation, beyond marketing copy. The sharer initializes
an authenticated WebSocket with serialized scrollback, prompt and window/input
state. The receiver handles ordered terminal events and agent requests. On
the original machine, incoming PTY writes and agent prompts check participant
execution rights. CLI prompts enter the agent-specific rich-input submission
path; native Warp Agent prompts enter its controller. Pending third-party
harness prompts have a separate queue to prevent accidental dispatch to Oz.
[Sharer network][sharing-network], [local authorization and routing][sharing-adaptor].

This is broader authority than a transcript reply button. Granted execution
rights can allow terminal input and commands as well as agent prompts. The
source checks rights and stale-buffer conditions locally; the hosted service
also owns participant admission and role state. This review does not audit
the service's enforcement. YA's owner login grants broad operator authority
too; its current public share links are read-only. Restricted users and
provider permission settings are separate boundaries in both comparisons.
[Sharing contract][sharing-doc], [YA security](../../topics/security.md),
[YA share rules](../../topics/relay-origin-and-share-gating.md).

### Published sessions are uploaded content

Warp sends session content to its service, rather than using YA-style
application-layer encrypted owner traffic. In the inspected path, scrollback
is a field in the serialized initialization payload, and live terminal events
are serialized/compressed messages over the server connection. The official
contract explicitly says scrollback and live output are uploaded to Warp.
TLS protects transport; it does not hide that content from the service.
[Network implementation][sharing-network], [sharing contract][sharing-doc].

The sharing contract documents expiry about one week after creation and no
separate per-session early-delete control. Stopping a share ends live access;
it is not documented as immediately deleting stored data. Secret Redaction is
explicitly not applied to Session Sharing. These are product/data-boundary
differences, not a finding that Warp's infrastructure is compromised.
[Retention and redaction][sharing-doc].

YA's authenticated relay path uses SRP and NaCl so the relay operator cannot
read application payloads. This protects the supervision transport, not
provider inference: the selected coding provider still receives its normal
inputs. YA's intentionally public bearer shares have a separate plaintext
relay exception, so “all YA content is invisible to the relay” would be wrong.
[Architecture](../../ARCHITECTURE.md), [security](../../topics/security.md),
[public-share exception](../../topics/relay-origin-and-share-gating.md).

### Mobile access and process lifetime are separate

A mobile browser can view and steer a published session. That is direct
competition for YA's phone use case even without a native Warp mobile app.
No native iOS/Android companion source or verified store distribution was
established here. No mobile typing latency, narrow-screen usability or
background-notification delivery was measured. The Rust/WASM viewer is source
present; desktop feature breadth is not evidence of mobile feature parity.
[Remote access contract][remote-control-doc], [viewer implementation][sharing-viewer].

Publishing does not transfer local execution into a cloud worker. The docs say
sync stops on closing or stopping publication. A local terminal manager shuts
down its PTY event loop on drop; session restoration reconstructs windows,
tabs, panes and output from SQLite. Neither establishes detachable local-agent
execution across Warp app shutdown. Cloud execution supplies a separate
laptop-independent route. Local-to-cloud promotion is documented for Warp
Agent, **not ordinary third-party CLI sessions**.
[Terminal owner][terminal-manager], [restoration][restoration-doc],
[handoff coverage][handoff-doc].

YA's provider execution continues when viewing clients disconnect. Its
API-server reload guarantee is narrower: durable provider-host ownership is
available in supported Linux/macOS Node source-checkout launches; Linux
defaults enabled, macOS defaults disabled while active-turn interruptions are
investigated, and fallback ownership remains inside Hono. Do not turn that
development-runtime capability into a universal packaged-runtime guarantee.
[Reload contract](../../topics/reload-safe-provider-runtimes.md),
[interruption gap](../../gaps/macos-provider-host-turn-interruptions.md).

## History, forks and handoff

### Warp has real forks from earlier turns

Warp documents current-conversation forks, `/fork`, `/fork-and-compact`, and
`/fork-from` selecting an earlier exchange. Its SQLite history implementation
copies tasks into a new conversation, preserves relevant execution settings,
tracks the source server token and stores the result. This is substantial
overlap with YA's branching experience. It is not justified to advertise
forking as something Warp lacks. [Fork contract][fork-doc], [fork implementation][history-model].

The reviewed native-conversation fork implementation does not establish that
Warp can fork an arbitrary local Claude/Codex history at a selected provider
turn. Third-party PTY sessions do not use the same history model. YA's fork
primitive operates on native Claude, Codex and Pi histories, with
provider-specific limits. YA also has an open repair for clone/fork settings
inheritance; parity should include those settings rather than only the
existence of a button. [Task-sync boundary][task-sync],
[YA fork support](../../topics/provider-fork-support.md),
[settings repair](../tactical/140-clone-session-settings-inheritance.md).

### Native transcript handling is also shared

Warp's platform Claude and Codex drivers capture native transcript envelopes,
upload them to designated server targets, fetch them for resume, and rehydrate
provider session files. Claude capture includes subagent files and todo state;
Codex handling respects `CODEX_HOME` and the dated rollout-file layout. The
capture reader bounds line size, total bytes and record count and retries
incomplete captures. Thus “Warp only has proprietary history” is inaccurate.
[Claude transcript][claude-transcript], [Codex transcript][codex-transcript],
[capture/upload][transcript-persistence], [harness drivers][claude-harness].

The distinction is **discovery and canonical catalog scope**. The paths reviewed
capture/resume a known managed session; Warp's conversation list combines its
native local metadata and server tasks. No equivalent of YA's broad catalog
of sessions started in other terminals, VS Code or first-party desktop apps
was established in those paths. This is a scoped negative finding, not proof
that no extension or future feature can import such a history.
[Conversation catalog][conversation-catalog],
[YA retained catalog](../../topics/session-catalog-observation.md).

Native Warp conversations have a bounded local retention policy: the reviewed
SQLite writer targets 200 conversation rows and evicts older orchestration
trees atomically, retaining the freshest tree even if it exceeds the budget.
That limit is not a 200-session cap for the entire cloud service or every
third-party provider file. Optional cloud-synced conversations are another
storage surface. [Local retention][agent-persistence], [cloud sync][cloud-conversations-doc].

### Remote control, cloud sync and handoff are different guarantees

Cloud conversation sync stores snapshots. The docs explicitly say that
opening a snapshot on two machines lets each continue independently; this is
not live single-writer migration. Live Agent Session Sharing is separate.
Local-to-cloud handoff forks Warp Agent history and packages tracked/untracked
workspace changes. Patch application is best-effort and can partially succeed.
Cloud-to-cloud continuation supports Warp Agent, Claude and Codex; cloud-to-local
continuation does not currently apply the cloud workspace patch to the local
checkout. [Cloud sync][cloud-conversations-doc], [handoff][handoff-doc],
[local promotion][local-handoff-doc].

These are useful continuity features, but not an atomic transfer of a single
provider process and workspace between arbitrary peers. YA's
[federated super-session](../../topics/federated-super-sessions.md) is also a
proposal, not shipped parity. Compare explicit ownership, workspace state and
resume identity rather than the generic phrase “continue anywhere.”

## Orchestration and factories

### The platform goes well beyond flat parallel tabs

Warp documents one parent plus direct children, each with independent run,
conversation, status and usage. Supported placement includes local/local,
local/cloud, cloud/cloud and children inside the parent's cloud environment.
The same hosted message bus coordinates harnesses and locations. Children can
wake for follow-up messages after terminal states. Parent cancellation does
not automatically cancel children; the documented cancel API also has
limitations for local/self-hosted/GitHub Action runs.
[Orchestration contract][orchestration-doc], [run operations][orchestration-runs-doc].

There is implementation substance behind the messaging claim. The client
tracks event sequence cursors, rejects callbacks from superseded connections,
persists cursor state, hydrates messages and reconciles child signals. The
Claude parent-message bridge uses on-disk staged/surfaced message records and
hook-output acknowledgement to supply coordination context. The hosted
message bus and its global ordering/durability promises were not executed or
audited here. Recursive helper code in the UI does not override the documented
one-level product limit. [Event streamer][orchestration-streamer],
[Claude bridge][claude-parent-bridge], [topology helpers][orchestration-topology].

One consequential source detail: hidden local Claude children are launched
with `--dangerously-skip-permissions`; the local Codex command builder uses
`--dangerously-bypass-approvals-and-sandbox`, subject to its product gate.
The Claude comment explains that hidden children otherwise block on invisible
approval prompts. Human approval of a launch plan and provider approval of
individual child actions are different controls. These paths should not be
described as inheriting ordinary per-tool approvals. YA can also run broad
provider permission modes; its operator has OS-account authority. This is a
workflow-default comparison, not a claim that one product safely sandboxes
every agent. [Child commands][local-child-launch],
[local gate][local-harness-setup], [YA authority](../../topics/security.md).

### Factories make production workflow the unit of management

Factories are early access for selected teams. A foreman maintains the work
item and dispatches triage, specification, implementation and review agents.
The default workflow asks for spec approval and ambiguous decisions, then
hands off a PR for a human merge. Spec/question gates live in instructions;
human-only merging needs forge permissions and branch protection. Review
verdicts are advisory. [Factory workflow][factory-workflow].

The versioned definition includes agents, automations, runners, skills,
webhooks, benchmarks and scorers. Definitions can live in Warp-managed Git or
a customer GitHub repository. Invalid configuration does not partially apply;
the previous valid definition remains active. An agent can propose changes to
the factory itself, and scorers/self-improvement propose reviewable follow-up
changes. These are documented hosted-service capabilities, not features proven
by running the client repository. [Definition format][factory-definition],
[factory workflow][factory-workflow].

Factory MCP also works with coding agents outside Warp. It can submit work,
retrieve task context for local continuation, communicate with the foreman,
and validate definitions. Warp can compete for the coordination layer even
when the developer keeps their existing terminal or supervisor.
[Factory MCP][factory-mcp].

Scheduled runs use cron, fixed prompts, fresh sessions, pause/update/delete,
and optional self-hosted worker selection. This is concrete competition for
YA's [yacron direction](../../topics/yacron.md), whose generally running
scheduler remains an [open gap](../../gaps/sketches/yacron-scheduler.md).
YA's existing Project Queue is not equivalent to recurring unattended jobs.
[Scheduled agents][schedules-doc].

## Self-hosting moves execution, not platform ownership

`oz-agent-worker` is an outbound authenticated WebSocket daemon. It accepts
centrally assigned tasks and supports Docker, Kubernetes, Direct and Command
backends. Direct gives per-task directories, not a container security boundary.
Command delegates to an operator-provided dispatch command and lets the remote
runtime report completion. This is more flexible than a Docker-only worker.
[Worker README][worker-readme], [worker loop][worker-loop],
[Direct backend][worker-direct], [Command backend][worker-command].

Connection loss and worker loss are treated differently. The worker retries
connections and queues outbound messages in memory. Kubernetes and Command
backends advertise preservation of active tasks on worker shutdown; other
backends follow cancellation/cleanup. Kubernetes preservation protects Jobs
from worker rotation, not from loss of the actual task Pod or its workspace.
The in-memory queue does not establish durable delivery after worker-process
death. No failover or restart experiment was run for this review.
[Shutdown logic][worker-loop], [queue][worker-queue], [Kubernetes][worker-kubernetes].

The factory security contract explicitly retains coordination, identity,
configuration, observability, transcript/artifact storage and inference routing
in Warp's control plane. Customer execution can still send code context through
prompts, transcripts, outputs and artifacts. Third-party Claude/Codex inference
has its own direct-provider credential path. “The repository checkout stays
on our machines” is therefore not equivalent to “the supervisor service cannot
see code or session content.” [Factory boundaries][factory-infrastructure],
[network/data boundaries][self-host-security], [third-party auth][harness-auth].

Documented factory workers use Linux amd64/arm64, whereas the worker repository's
release workflow builds Linux, Darwin and Windows binaries for both architectures.
Binary targets alone do not establish every backend/factory placement as a
supported production option. Hosted runner documentation separately advertises
Linux containers and Apple Silicon macOS VMs with Xcode/simulators. No native
Windows hosted runner was established by that contract.
[Factory infrastructure][factory-infrastructure], [worker release matrix][worker-release],
[hosted runners][runners-doc].

YA's released SSH executor remains Claude-family-specific, with a matching
checkout and transcript synchronization. Its managed Codex runner/workspace
proof is operator-only, not a generally exposed placement UI. Warp is ahead on
published execution-target and environment management; YA should not claim
equivalent orchestration from the existence of SSH settings.
[YA execution contract](../../topics/managed-remote-executors.md),
[provider-neutral gap](../../gaps/sketches/provider-neutral-remote-executors.md),
[placement discussion](../../topics/multi-machine-architecture.md).

## Developer workflow and test evidence

Warp integrates terminal execution, code editing, Git diffs, inline review
comments, file context and worktrees. Worktree creation has actual tab-config
generation for `git worktree add -b` and entering the new checkout, beyond
recognizing a manually created worktree. Repo watchers distinguish shared Git
metadata from worktree-specific state. [Review contract][review-doc],
[creation implementation][worktree-config], [worktree contract][worktrees-doc],
[watcher][repo-watcher].

YA already has [Source Control](../../topics/source-control.md), file/diff/
blame/history inspection and agent-directed review comments. Direct mutations
are deliberately limited to Check, fast-forward Pull and Push; staging,
committing and destructive Git operations remain agent work. Its
[workstreams](../../topics/workstreams.md) direction uses ordinary lane clones
and remains proposed. The relevant comparison is workflow depth and explicit
workspace ownership, not “Warp has Git; YA does not.”

Warp documents sandbox Computer Use, a bundled browser, screenshots and
recordings attached to PRs. Third-party cloud harnesses do not integrate with
its Computer Use tooling by default. YA's Android/Apple Simulator streaming
and optional Windows computer-control preview target different execution and
device boundaries. No parity or quality judgment between these mechanisms
was established. [Computer Use][computer-use-doc], [YA roadmap](../roadmap/README.md).

The codebase has focused tests for notification parsing/state, shared-session
reconnect, input routing, forks, task sync, harness capture and worker lifecycle.
Their presence provides inspection leads, not passing results. In particular,
this review did not test sequential typing during concurrent output. Native
Rust rendering, WASM reuse, cached list identities and bounded transcript
capture are engineering choices, not evidence of latency superiority over YA.
[Reconnect tests][sharing-tests], [CLI tests][cli-tests], [fork tests][history-tests],
[worker tests][worker-tests], [conversation list][conversation-list].

## Feature comparison with Yep Anywhere

“Not established” is a scoped review limit. Source-present functionality and
documented hosted behavior are distinguished in the detailed sections above.

| Area | Warp | Yep Anywhere |
| --- | --- | --- |
| Primary workflow | Terminal development environment, own agent, enhanced third-party CLIs | Browser/mobile supervisor for provider-native agents and histories |
| Remote local-agent control | Published terminal/agent session through Warp service; viewer execution roles | Direct or encrypted authenticated relay to user's server |
| Existing external histories | Known-run native capture/resume; broad external catalog not established | Discovers histories created in CLI, IDE and first-party tools |
| Attention | CLI/native mailbox and tab status; personal factory work-item inbox | Tiered session Inbox across discovered and YA-owned histories |
| Browser disconnect | Remote viewer can leave while original execution owner remains | Provider runs independent of viewing client |
| Local app/server restart | UI/history restoration and sharing reconnect; detached desktop-PTY continuity not established | Conditional durable provider-host reload; ordinary in-Hono fallback |
| Conversation branches | Earlier-turn native Warp forks and cloud continuation; arbitrary local CLI-turn fork not established | Native Claude/Codex/Pi forks and clone; settings-inheritance repair pending |
| Provider breadth | Fifteen advertised local CLI integrations; three published cloud harness IDs | Claude/Codex primary; additional integrations experimental and capability-specific |
| Placement and orchestration | Hosted/self-hosted runs, one-level parent/children, cross-harness messaging | Multiple independent servers; narrower SSH executor; broader managed placement remains operator-only/proposed |
| Unattended automation | Cron, integration triggers, API, factories and evaluations | Project Queue; general yacron scheduler proposed |
| Code and Git | Terminal/editor/review/worktree development environment | Source Control inspection and review; narrow explicit Git mutations |
| Workspace isolation | Worktree creation; hosted sandboxes; backend-specific customer execution | Provider sandbox options; ordinary-clone workstreams proposed |
| Collaborative agent input | Participant roles, prompts and terminal execution in shared sessions | Public shares read-only; limited-user grants available; participatory sharing proposed |
| Hosted data boundary | Published output/transcripts can be read by Warp service | Authenticated owner relay payloads encrypted; public share transport is a separate exception |
| Provider accounts | Local tools retain their provider authentication; cloud harnesses use stored API credentials | Uses eligible signed-in provider plans and supported local/gateway variants |
| Distribution | Documented macOS, native Windows and Linux desktop; mobile browser access | Web/PWA and signed macOS/Windows desktop beta; Android/iOS shells implemented, public stores pending |
| Source and operations | AGPL client, MIT UI crates/worker/plugin; hosted platform still required for platform services | MIT supervisor/server; hosted account unnecessary for core; optional relay/push services |

YA sources: [Inbox](../../topics/inbox.md),
[catalog](../../topics/session-catalog-observation.md),
[forks](../../topics/provider-fork-support.md),
[security](../../topics/security.md),
[reload](../../topics/reload-safe-provider-runtimes.md),
[execution](../../topics/managed-remote-executors.md),
[Source Control](../../topics/source-control.md),
[public shares](../../topics/relay-origin-and-share-gating.md),
[participatory sharing proposal](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share),
and [roadmap](../roadmap/README.md).

## Pricing and distribution affect the threat

The live pricing page showed Free at $0, Build starting at $20/month, Max at
$200/month, Business at $50/user/month and Enterprise by contract; annual
displayed rates were lower. Free lists limited collaboration and cloud storage,
while Build lists unlimited collaboration/storage. These are dated advertised
plan summaries, not a quote for a specific Remote Control workload.
[Pricing](https://www.warp.dev/pricing), checked 2026-10-02.

Directly running third-party CLIs in a terminal does not consume platform
credits. Platform cloud runs do, including runs on self-hosted compute; cloud
Claude/Codex also incur provider inference costs and hosted compute where used.
YA should not claim that a Warp user must pay Warp inference charges merely
to run their existing local Claude/Codex CLI. Exact remote-sharing quotas were
not independently established. [Platform billing][platform-credits],
[harness billing][harness-overview].

Warp's desktop availability and existing terminal audience provide a useful
distribution route: a user can encounter supervision and Remote Control inside
a tool they already use. This is a competitive inference, not measured
conversion evidence. Factories adds team workflow and integration distribution,
including Factory MCP outside the terminal. YA's release priority remains
relevant because easy installation and phone continuity make its architectural
differences accessible. [Installation][installation-doc],
[Factory MCP][factory-mcp], [YA release priority](../roadmap/README.md).

## Documentation conflicts and unverified edges

The snapshot contains disagreements that should not be smoothed into a single
unqualified feature checklist:

| Topic | Conflicting or incomplete evidence | Treatment in this analysis |
| --- | --- | --- |
| Codex notifications | General notification/support pages describe native config/OSC behavior; the specific Codex page and plugin manager use `warpdotdev/codex-warp` | Prefer specific page and source; legacy fallback has weaker status |
| Shared-link admission | Remote Control page says anyone with a link can watch; the detailed live-sharing contract says viewers sign in and access follows invitations/team/link policy | Use the detailed ACL contract; actual deployed admission not tested; cloud snapshot links are another surface |
| Free cloud harnesses | Live pricing advertises any harness in cloud beta on Free; harness docs require Build or higher | Plan entitlement unresolved; no promise that Free can launch Claude/Codex cloud runs |
| Inference routing | General self-hosting security prose says inference routes through Warp; third-party auth docs explicitly say Claude/Codex call providers directly | Keep Warp Agent routing separate from third-party harness inference |
| Worker platform support | Factory guide names Linux worker platforms; release workflow builds Darwin/Windows too | Distinguish a binary build target from supported factory/backend deployment |

Sources: [general notifications][notifications-doc], [specific Codex setup][codex-doc],
[plugin manager][codex-plugin-manager], [Remote Control][remote-control-doc],
[live-sharing policy][sharing-doc], [cloud snapshots][cloud-conversations-doc],
[pricing](https://www.warp.dev/pricing), [harness plans][harness-overview],
[self-host security][self-host-security], [auth][harness-auth],
[factory infrastructure][factory-infrastructure], [worker builds][worker-release].

General ZDR/inference privacy statements should not be read as “no session
storage”: published shares, cloud transcripts and factory run artifacts have
their own storage purpose and policies. The privacy page also documents
telemetry controls and plan-dependent AI data collection; actual account
settings and backend retention were not tested. Nothing here establishes a
security certification, privacy audit, or source completeness of the hosted
service. [Privacy controls][privacy-doc], [sharing retention][sharing-doc],
[factory storage][factory-infrastructure].

## Implications for YA

This review does not reprioritize the [roadmap](../roadmap/README.md).
Public app distribution and continuous delivery remain first. The existing
tasks/gaps search found no Warp-specific plan; the relevant scheduling,
execution, collaboration and workspace documents below already own that work.

1. **Treat local Remote Control as a direct competitor.** The user deciding
   how to supervise Claude from a phone can reasonably choose Warp. Compare
   published-per-pane access with YA's server-wide catalog, independent client
   lifetime and encrypted owner connection, rather than dismissing Warp as
   factory software.
2. **Use narrower differentiation.** Lead with discovery of existing provider
   histories, the scope of the session inbox, and private remote supervision.
   Acknowledge Warp's native transcript portability, earlier-turn forks and
   attention features. The [fork settings repair](../tactical/140-clone-session-settings-inheritance.md)
   and [macOS continuity gap](../../gaps/macos-provider-host-turn-interruptions.md)
   prevent broad continuity claims today.
3. **Learn from capability confidence.** Warp separates command detection,
   legacy stop signals and structured status. Apply that distinction when
   assessing YA's experimental providers under existing provider/session
   contracts, rather than treating an agent name as evidence of full parity.
4. **Use workflow receipts as scheduling prior art.** Factory questions,
   approvals, PR reviews and automatic resolution illustrate attention that
   follows work through a lifecycle. This informs [yacron](../../topics/yacron.md)
   and its [gap](../../gaps/sketches/yacron-scheduler.md), without authorizing a
   factory engine or displacing the required scheduling UI design.
5. **Keep ownership explicit in multi-machine work.** Viewer access, managed
   worker execution, transcript continuation and session migration differ.
   The [placement map](../../topics/multi-machine-architecture.md),
   [managed runner contract](../../topics/managed-remote-executors.md),
   [remote project-view gap](../../gaps/remote-session-project-views-use-local-files.md)
   and [provider-neutral executor gap](../../gaps/sketches/provider-neutral-remote-executors.md)
   already capture YA's related constraints.
6. **Preserve deliberate collaboration authority.** Warp provides substantial
   co-control now; YA's public shares remain read-only. Use it as a concrete
   comparison for [participatory Live Share](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share)
   and [notes/discussion](../../topics/session-notes-and-discussion.md), while
   preserving [principal/grant distinctions](../../topics/principals-and-grants.md).
   A participant's ability to observe, discuss, suggest input and execute on a
   host must remain separate.
7. **Compare workspace workflows within the existing direction.** Warp's
   worktree creation and review are useful references for
   [workstreams](../../topics/workstreams.md), which chooses ordinary clones.
   Its factory/PR workflow does not select a new YA Git model or authorize a
   general IDE, terminal or forge expansion.

Revisit when Warp publishes verified mobile companion apps, broad external
provider-history discovery, third-party local-to-cloud promotion, an
independently deployable control plane, or a different encrypted-sharing
boundary. Also recheck local child harness gates, permission defaults, share
retention/admission and Free-plan cloud entitlements before a hands-on trial.

## Source index

Implementation and documentation references throughout this review are pinned
to the inspected commits. Live pricing and repository metrics are explicitly
dated above.

- [Client and viewer source][warp-tree]: terminal supervision, sharing,
  persistence, forks, harness drivers and orchestration.
- [Official documentation][docs-tree]: feature contracts, data boundaries,
  factories, runners and plan rules.
- [Claude integration][plugin-tree]: notification hooks and harness support.
- [Execution worker][worker-tree]: dispatch backends and lifecycle.

[warp-tree]: https://github.com/warpdotdev/warp/tree/3f37d69ff3e87818d24f803c16b2e045fa4bd95e
[warp-readme]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/README.md
[cli-sessions]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/cli_agent_sessions/mod.rs
[task-sync]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/blocklist/local_agent_task_sync_model.rs
[agent-persistence]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/persistence/agent.rs
[multi-client]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/crates/warp_multi_agent_client/src/lib.rs
[cli-detection]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/cli_agent.rs
[orchestration-validation]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/orchestration/validation.rs
[local-harness-setup]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/local_harness_setup.rs
[local-child-launch]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/pane_group/pane/local_harness_launch.rs
[cli-protocol]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/crates/warp_core/src/cli_agent_protocol.rs
[cli-parser]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/cli_agent_sessions/event/v1.rs
[cli-listener]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/cli_agent_sessions/listener/mod.rs
[notifications-model]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/agent_management/agent_management_model.rs
[sharing-network]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/shared_session/sharer/network.rs
[sharing-adaptor]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/local_tty/terminal_view_adaptor.rs
[sharing-viewer]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/shared_session/viewer/mod.rs
[terminal-manager]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/local_tty/terminal_manager.rs
[history-model]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/blocklist/history_model.rs
[claude-transcript]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/agent_sdk/driver/harness/claude_transcript.rs
[codex-transcript]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/agent_sdk/driver/harness/codex_transcript.rs
[transcript-persistence]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/agent_sdk/driver/harness/transcript_persistence.rs
[claude-harness]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/agent_sdk/driver/harness/claude_code.rs
[conversation-catalog]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/agent_conversations_model.rs
[orchestration-streamer]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/blocklist/orchestration_event_streamer.rs
[claude-parent-bridge]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/agent_sdk/driver/harness/claude_code/parent_bridge.rs
[orchestration-topology]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/blocklist/orchestration_topology.rs
[worktree-config]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/tab_configs/tab_config.rs
[repo-watcher]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/crates/repo_metadata/src/watcher.rs
[sharing-tests]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/shared_session/sharer/network_tests.rs
[cli-tests]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/cli_agent_sessions/mod_tests.rs
[history-tests]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/ai/blocklist/history_model_tests.rs
[conversation-list]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/workspace/view/conversation_list/view_model.rs
[codex-plugin-manager]: https://github.com/warpdotdev/warp/blob/3f37d69ff3e87818d24f803c16b2e045fa4bd95e/app/src/terminal/cli_agent_sessions/plugin_manager/codex.rs
[docs-tree]: https://github.com/warpdotdev/docs/tree/dbaf7ae2d45f714ce0585085b5708c19bfb6906a
[cli-overview]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/cli-agents/overview.mdx
[factory-infrastructure]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/factories/infrastructure-and-security.mdx
[harness-auth]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/harnesses/authentication.mdx
[harness-overview]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/harnesses/index.mdx
[notifications-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/capabilities/agent-notifications.mdx
[factory-inbox]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/factories/factory-inbox.mdx
[remote-control-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/cli-agents/remote-control.mdx
[sharing-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/local-agents/session-sharing.mdx
[restoration-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/terminal/sessions/session-restoration.mdx
[handoff-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/handoff/index.mdx
[fork-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/local-agents/interacting-with-agents/conversation-forking.mdx
[cloud-conversations-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/local-agents/cloud-conversations.mdx
[local-handoff-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/handoff/local-to-cloud.mdx
[orchestration-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/orchestration/index.mdx
[orchestration-runs-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/orchestration/multi-agent-runs.mdx
[factory-workflow]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/factories/how-factories-work.mdx
[factory-definition]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/factories/factory-as-code.mdx
[factory-mcp]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/factories/factory-mcp.mdx
[schedules-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/triggers/scheduled-agents.mdx
[self-host-security]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/self-hosting/security-and-networking.mdx
[runners-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/platform/runners.mdx
[review-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/code/code-review.mdx
[worktrees-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/code/git-worktrees.mdx
[computer-use-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/capabilities/computer-use/index.mdx
[platform-credits]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/support-and-community/plans-and-billing/platform-credits.mdx
[installation-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/getting-started/quickstart/installation-and-setup.mdx
[codex-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/agents/cli-agents/codex.mdx
[privacy-doc]: https://github.com/warpdotdev/docs/blob/dbaf7ae2d45f714ce0585085b5708c19bfb6906a/src/content/docs/support-and-community/privacy-and-security/privacy.mdx
[plugin-tree]: https://github.com/warpdotdev/claude-code-warp/tree/8c28e936ae51cbb23a1a5657fca2bfd30cf06f12
[plugin-readme]: https://github.com/warpdotdev/claude-code-warp/blob/8c28e936ae51cbb23a1a5657fca2bfd30cf06f12/README.md
[plugin-license]: https://github.com/warpdotdev/claude-code-warp/blob/8c28e936ae51cbb23a1a5657fca2bfd30cf06f12/LICENSE
[worker-tree]: https://github.com/warpdotdev/oz-agent-worker/tree/19f897d934a898f04b8d30ae993d2e94b3e6fe18
[worker-license]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/LICENSE
[worker-readme]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/README.md
[worker-loop]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/internal/worker/worker.go
[worker-direct]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/internal/worker/direct.go
[worker-command]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/internal/worker/command.go
[worker-queue]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/internal/worker/outbound_queue.go
[worker-kubernetes]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/internal/worker/kubernetes.go
[worker-release]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/.github/workflows/build_release.yml
[worker-tests]: https://github.com/warpdotdev/oz-agent-worker/blob/19f897d934a898f04b8d30ae993d2e94b3e6fe18/internal/worker/worker_test.go

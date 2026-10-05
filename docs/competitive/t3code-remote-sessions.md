# T3 Code remote environments: ownership, workspaces and recovery

Reviewed 2026-10-03 against upstream `main` at
[`fed41fa88bb27cb4325cb208d571393850bc63c2`][revision].
This is a focused source review for understanding YA's remote-execution choices,
not an implementation plan or a claim that T3's maintainers prefer every detail
of the current design.

The local reference checkout is `references/t3code`. It was updated from the
September 4 snapshot `d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70`:
`git pull --ff-only origin main` fetched a rewritten upstream branch and refused
to merge divergent history. The clean checkout was then switched, detached, to
`origin/main`, preserving the old local `main`. A separate `git ls-remote origin
refs/heads/main` returned the same full SHA as the checked-out HEAD. Thus this
review uses the newest upstream revision observed during the review, rather
than selected files from an older checkout mixed with online `main`.

Evidence is implementation and test-source inspection, supported by upstream
user and architecture documents. No T3 server, provider login, cloud enrollment,
SSH target or live sleep/reconnect experiment was started. Tests cited below
were inspected, not executed. Release-channel availability may lag this source
revision. Links to T3 below are pinned to the reviewed commit.

## 1. The central choice

**T3 makes the remote computer a complete, authoritative development
environment. The viewing computer is a client of that environment.**

An environment owns its provider adapters and processes, project directories,
Git operations, terminals, credentials and durable thread state. A local
desktop environment uses the same boundary. The desktop renderer can even run
with its own local environment disabled and operate only remote environments.
Direct networking, Tailscale, T3 Connect and SSH are ways to reach an owner;
they do not relocate ownership to the viewing laptop. [Architecture][architecture]
[Remote architecture][remote-architecture]

```text
Laptop / phone / hosted browser UI
  | independently authenticated connections
  +-------------------------+-------------------------+
  v                         v                         v
Environment A               Environment B             Environment C
T3 server + database        T3 server + database      T3 server + database
provider processes          provider processes        provider processes
local Git checkout          local Git checkout        local Git checkout
local credentials           local credentials         local credentials
```

There need not be a master T3 server on the laptop between the UI and the other
machines. There is also no requirement that all environment servers know one
another. T3 Connect adds account discovery and admission brokerage; it does not
become the owner of the agent's working directory or conversation database.

This explains much of the simpler remote-workflow appearance: T3 treats the
target as a computer with a usable development setup. It still has workspace,
credential and lifecycle complexity, but mostly handles it on that computer
rather than implementing controller-to-worker source transfer.

## 2. What the nouns mean

| Object | Meaning and owner |
| --- | --- |
| Environment | One T3 server identity and its machine-local execution/state. Its identity survives endpoint changes and ordinary restarts. |
| Connection | A client's saved route and authorization for an environment. Forgetting a connection is distinct from deleting the environment's work. |
| Project | A record rooted at a directory on one environment. |
| Repository identity | A way to correlate checkouts of the same repository for presentation; not permission to substitute one checkout for another. |
| Thread | An environment-owned application conversation with project/workspace references and persisted history. |
| Provider session/thread | The adapter's live runtime and native continuation references beneath the application thread. These have different lifetimes. |
| Worktree | A Git working directory on the owning environment, optionally isolated for a thread. |

The shared client scopes references by environment. Project grouping can use a
canonical repository identity, including a repository-relative project path
where appropriate, or keep physical checkouts separate. The physical key
includes the environment and path. Grouping does not merge databases, share
uncommitted files, or establish that two branches contain the same commits.
[Remote architecture][remote-architecture] [Project grouping implementation][grouping]

## 3. What the command and QR-code setup actually does

The remembered “run something and scan a code” combines several separate paths.

### Start a server

`npx t3@latest` can run T3 without a permanent CLI installation. The installed
CLI also provides `t3 serve`. This starts a full environment server, not a
provider-only worker injected into another server's session. Provider setup is
still a prerequisite; `npx` does not itself sign the machine into an agent
account. [Installation][install]

### Pair a reachable client

`t3 pair` discovers an already running server using its persisted runtime
information, checks its environment descriptor, and issues a pairing link and
terminal QR code. `t3 pair --tailscale` can arrange the Tailscale HTTPS route.
The new device redeems a one-time bootstrap credential for its own environment
session. It subsequently reconnects using that session rather than retaining
the original QR token. A direct pairing address must actually be reachable
from the receiving device. [Pair command][pair] [Remote-access guide][remote-guide]

This operation authorizes a **client to access a server**. It does not clone a
project, distribute an SSH key, configure GitHub, or transfer a provider login.

### Link through T3 Connect

`t3 connect` signs the environment into the cloud discovery/exposure system and
offers background-service setup. SSH/headless use selects a device-authorization
flow: the CLI prints a browser URL and short code, and polls while the user
approves elsewhere. An ordinary local-browser authorization path is separate.
Saved authorization and desired exposure can exist while the server is stopped;
they do not by themselves establish a live environment. Other devices signed
into the same account discover the linked environment. [Connect CLI][connect-cli]
[Connect architecture][connect-architecture]

The reviewed architecture uses a managed tunnel endpoint for application
traffic. The relay brokers environment access; the client subsequently talks
to the environment through that endpoint. Installing a background service,
linking an account and keeping a network route alive are three different jobs.

### Add an SSH environment from desktop

The desktop app can resolve an SSH alias/host, start or reuse T3 on it, create a
port forward and obtain an environment pairing credential. The renderer then
uses ordinary authenticated HTTP/WebSocket RPC through the forward. This is
remote **server** bootstrap, not piping provider prompts through an SSH stdio
session. [SSH implementation][ssh] [Desktop SSH adapter][desktop-ssh]

## 4. SSH bootstrap and its less obvious lifetime contract

The packaged path downloads a versioned runtime archive, verifies it, and
installs it under the remote account's T3 runtime directory. The published
target prerequisites are Linux or Apple Silicon macOS, download/extraction/hash
utilities, and provider setup. The release archive path does not need remote
Node/npm/npx; a development runner override has separate Node requirements.
Provider CLIs still need to be visible to a non-interactive remote shell.
[SSH guide][remote-guide] [Runner construction and tests][ssh-tests]

The implementation distinguishes `managed` and `external` server ownership:

1. Inspect default T3 runtime information and launcher state.
2. Reuse a suitable existing server as external ownership, or start a managed
   server if needed.
3. Start a managed server with `nohup`, redirected logs, and stdin from
   `/dev/null`; record its PID, port and ownership marker.
4. Establish a separate `ssh -N -L` forward to remote loopback.
5. Pair with the remote environment through its CLI/auth mechanism when needed.

The target therefore does not need an externally exposed T3 listening port for
this route. SSH authenticates the machine account; T3 pairing authenticates
the application client. [Launch script and tunnel][ssh]

**Detached process startup does not imply unconditional session survival.**
The same module owns explicit remote-stop behavior:

- Removing/disconnecting the SSH environment stops a server the launcher owns.
  An external server is left running.
- Closing the tunnel manager's scope closes its entries; an entry finalizer
  attempts remote shutdown when that entry remains the current owner.
- A stale tunnel detected by `ensureTunnelEntry` is closed before replacement.
  That close reaches the same finalizer and can attempt to stop a managed
  server. Stop failures are ignored in the finalizer, unlike explicit
  disconnect, which exposes failure.
- Per-target locks prevent reconnect from racing a still-pending shutdown.
  A managed runner change or failed readiness check can also cause replacement.

These are direct source observations in `closeTunnelEntry`,
`ensureTunnelEntry`, the entry finalizer and `REMOTE_STOP_SCRIPT`. The tests
explicitly cover shutdown failure and waiting for local/remote shutdown before
reconnecting. They do not establish a universal live-turn sleep-survival
guarantee. [Implementation][ssh] [Tests][ssh-tests]

Consequently, “SSH is only a tunnel, so reconnect always retains the live
provider” would overstate this implementation. A separately installed remote
service, reused as an external server, has the clearer autonomous lifetime.
Actual laptop sleep/resume across each SSH ownership mode still needs a live
experiment before claiming uninterrupted execution.

## 5. The credentials a target actually needs

There are at least five independent authorization/configuration concerns:

| Concern | Normal T3 arrangement | Does pairing provide it? |
| --- | --- | --- |
| Login to the target OS over SSH | Desktop's configured SSH access, with support for authentication prompts | No |
| Access the T3 environment | Environment-issued client session; optionally bootstrapped through Connect | Yes, for the scopes granted |
| Use Claude/Codex/another provider | Provider credentials/configuration on the selected environment | No |
| Clone/fetch/push a private Git repository | Git transport authentication available to the environment's account | No |
| Call forge APIs, e.g. create a PR | Forge integration credentials on the environment, commonly its authenticated CLI | No |

Git commit author name/email is a further local configuration requirement, not
repository-host authentication. Signing commits can add its own credential/tool
requirements. A plain local commit does not need a GitHub SSH key.

T3's source-control instructions explicitly locate authentication on the
server machine, including for remote environments. GitHub uses authenticated
`gh`; GitLab uses `glab`; other integrations have their own CLI/token paths.
The source verifies GitHub CLI availability/auth status and executes operations
in a server-side cwd. An HTTPS credential helper and an SSH repository URL are
not interchangeable just because the GitHub API login works.
[Source-control guide][source-guide] [GitHub integration][github-provider]
[GitHub CLI service][github-cli]

The clone service executes ordinary `git clone --progress` in the selected
destination's parent directory. It sets `GIT_TERMINAL_PROMPT=0`, avoiding an
invisible interactive Git prompt. Missing credentials can therefore make an
otherwise successfully paired environment unable to clone. Public repositories
do not need private-repository credentials; pushing still requires authority.
[Clone service][clone]

The reviewed normal path does not copy the viewing laptop's Git credentials or
provider login into the remote environment. This is not a claim that a user's
custom SSH configuration cannot forward an agent: T3's base SSH arguments leave
ordinary SSH configuration relevant. Such forwarding is neither the documented
credential-provisioning workflow nor a sound basis for autonomy when the laptop
is offline. [SSH command construction][ssh-command]

Provider sign-in may be available through T3's provider-specific UI, rather
than always requiring manual terminal setup. The important property is where
the resulting provider authority is used and retained: the selected environment.
There is no general owner-laptop AAR-style inference dependency in this remote
environment design. [Provider setup][install] [Architecture][architecture]

### The bounded GitHub-sharing exception

Current T3 has explicit, default-off client-side GitHub request routing. Both
the original and answering environments need the relevant sharing permission;
the routing verifies compatible GitHub account identity. It can use another
connected environment for selected PR reads and review actions without moving
its credentials. A local connected environment is preferred for actions.

This is an allowlist of RPC operations, not transparent Git credential sharing.
Listings, diffs, checkout and PR creation from Git actions remain with the
project's environment as documented. Ambiguous write failures are not blindly
replayed elsewhere. Losing a laptop that supplies shared GitHub API access can
remove that convenience without making it the owner of the remote agent.
[Routing implementation][github-routing] [Permission storage][github-permissions]
[User contract][source-guide]

## 6. How projects and checkouts arrive on a machine

The ordinary workflow is to register a directory already on the environment,
clone a repository there through Add Project, or create a new repository there.
The selected environment's filesystem is authoritative in all three cases.

For cloning, the client chooses the environment and destination. The server
validates the destination and repository source, creates/tracks the project,
and performs the clone in a server-owned task. The UI can open the project and
accept a draft while cloning; sending waits for preparation. Clone progress,
cancellation and retry are explicit. A successful QR pairing is not evidence
that any project has already been provisioned. [Clone tracker][clone-tracker]
[Clone implementation][clone] [User workflow][source-guide]

For a new project, T3 can create its directory/repository, initial content and
first commit under its projects area, optionally publishing it. If Git identity
is missing, the documented new-project path can leave the first commit undone.
Again, this happens on the chosen machine.

For the same repository on laptop and remote host, T3 can correlate their
records and display them as a group. Each has its own checkout, branch state,
uncommitted changes and threads. Nothing in that grouping means “send the
laptop's current HEAD” or “include its dirty files.” [Grouping][grouping]

Compared with YA's managed-SSH baseline, T3 avoids making source delivery from
the controller the normal provisioning primitive. Git hosting and already
configured remote development machines supply that part of the workflow.

## 7. How a remote thread chooses and prepares its workspace

The server's thread-launch service has explicit strategies for an existing
project workspace, an existing worktree, or a newly provisioned worktree.
The workspace remains on the environment that owns the project. “Local” in this
context means local to that server, even when the UI is on a phone.
[Thread launch][launch]

For a new worktree, the reviewed path:

1. Accepts a selected base ref and optional new branch name.
2. Allocates a temporary `t3code/<hash>` branch if naming was not specified, so
   model-generated naming does not block checkout.
3. If **Start from origin** is selected and origin exists, fetches the requested
   ref. When the remote base exists, resolves its remote-tracking commit and
   starts from that commit. Without the applicable remote branch/origin, the
   described fallback is the local base; fetch errors are still errors.
4. Runs ordinary `git worktree add` with the selected start ref and branch.
5. Records the resulting workspace and branch on the thread.
6. Handles submodule setup and the project's setup script, with visible progress.
7. Starts provider work with the resulting effective cwd.

Synchronous setup must complete successfully before the prepared run is
released. An explicitly asynchronous setup script can overlap agent execution;
its completion is still tracked. “Setup runs” therefore does not mean every
configured background setup process finishes before the agent starts.

Branch-name generation can subsequently rename the branch while retaining the
worktree directory name. Settings allow naming conventions and project-specific
setup. This is broader than “always start from main”; it lets the user choose
the workspace/base without imposing a cross-machine handoff protocol.
[Launch service][launch] [Git worktree implementation][git-core]
[Project settings][project-settings]

Automatic pulling is another independent option. It only fast-forwards an
eligible clean default-branch checkout with an upstream; changed/untracked files
or local commits prevent the pull. It does not reconcile divergent checkouts
across environments. [Project settings][project-settings]

Worktree cleanup is likewise explicit and configurable. The documented policy
retains active/shared worktrees and those with uncommitted changes or protected
ignored content. Removing a safe worktree can retain branches and thread
history, allowing later recreation. Finishing an agent turn therefore need not
mean deleting its workspace. These are application-managed Git resources, not
disposable folders inferred solely from a disconnected client.

## 8. Committing, pushing, PRs and getting the result elsewhere

The normal path is conventional development on the remote checkout:

```text
Remote environment's repository
  -> thread workspace / branch
  -> agent changes files
  -> commit locally on that environment
  -> push using that environment's Git transport authority
  -> create PR using that environment's forge integration
  -> another machine fetches / pulls / reviews through ordinary Git
```

T3 exposes thread Git actions for commit, push and PR creation and can generate
their text. The provider can also run ordinary tools in that workspace according
to its execution permissions. There is no necessary automatic fetch-back into
the viewing laptop, merge into its branch, or restoration of its dirty files.
The client can inspect remote work in place. [Source-control workflow][source-guide]
[Git service][git-core] [GitHub operations][github-provider]

T3's **checkpoints** are a separate mechanism. They capture workspace state
under hidden Git refs for diffs/rollback without adding ordinary commits to the
user's branch. A completed turn/checkpoint therefore does not by itself mean
the user has made a branch commit, pushed it, or opened a PR. Rollback must
coordinate the workspace with provider conversation support.
[Checkpoint service][checkpoints] [Turn/checkpoint boundary][architecture]

This matters for YA: adopting environment-local worktrees does not require
adopting T3's hidden-ref checkpoint policy. YA's app-data/project-write rules
are a separate choice.

## 9. Multiple machines and automatic placement

The current web/desktop client can automatically choose an environment for a
new thread in a project grouped across connected environments. It is default-off;
mobile retains manual selection. The user can prefer a machine, reduce its
share or make it manual-only. Existing threads stay on their chosen machine.
Choosing a branch/worktree also fixes the draft's environment.
[Remote-access guide][remote-guide]

The selection helper scores eligible machines using preference weight, CPU
count, CPU utilization and available-memory fraction. Missing/stale readings,
very high CPU use, very low free memory or zero weight exclude a candidate.
Its caller supplies machines already hosting the project and selected provider.
There is no source-copy or VM-provisioning operation in this selector.
[Selection function][balance] [Resource-query hook][balance-hook]

This is **placement among existing environments**, not a global scheduler that
can migrate a live session or repair a missing checkout. Project grouping makes
the choice convenient; it does not make the selected machine interchangeable
after execution has begun.

## 10. What happens when the viewing laptop disappears

For an independently running environment, the provider runtime is server-owned,
not owned by the browser RPC subscription. The server's runtime layer and
provider-session manager outlive an individual client connection. Ordinary
client disconnect does not instruct the server to pause the agent.
[Runtime composition][runtime] [Provider session owner][sessions]

The accepted turn can keep running, emit persisted state, finish, or wait for
an approval/input/dependency. Another authorized client can observe and operate
the same environment if it has a route to it. A desktop-specific SSH route on
the sleeping laptop is not automatically a route available to a phone.

“Continue until completion” also needs care: already accepted queued work is
server-owned, so disconnect is not a new policy limiting execution to exactly
one turn. Provider failures, credentials expiring, approvals and external tools
remain ordinary execution constraints. [Queue behavior][composer]

When the laptop returns, the shared connection supervisor restores access and
subscriptions. It retains cached data during involuntary disconnect, retries
transient failures with jittered backoff, and handles mobile foregrounding.
Authentication problems are distinct from an ordinary transport retry.
[Connection runtime][connection-doc] [Supervisor][supervisor]

The client then catches up on **application state**. Thread streams have
sequence cursors and can replay a bounded suffix or replace it with a bounded
snapshot. At this revision the replay thresholds include 128 events and 1 MiB
of encoded events, with a separate raw-payload safety bound. A large offline
gap does not require an unbounded in-memory socket buffer.
[Thread stream][thread-stream]

This is UI reattachment to the existing owner. It does not normally call a
provider's resume API merely because a browser socket reconnected. Provider
resume is needed when the provider runtime itself is gone or deliberately
released, which is a different event.

## 11. Disconnect, shutdown and crash are different cases

| Event | Reviewed behavior / limit |
| --- | --- |
| Browser closes or phone backgrounds; independent server stays up | Execution remains server-owned; reconnect catches up on state. |
| Viewing laptop sleeps; target is an independently installed service | No laptop execution-owner dependency. The target must remain awake, running and able to reach its providers. |
| Viewing laptop sleeps; desktop launched a managed SSH server | Detached startup helps, but stale-tunnel cleanup/replacement can stop the owned server. Uninterrupted live-turn survival is not established by this review. |
| SSH connection explicitly removed | Stop the launcher-owned remote server; preserve an external server. This is more than forgetting a viewing route. |
| Linux service user's SSH login closes | systemd user service plus lingering is the supported unattended arrangement. |
| macOS host logs out or sleeps | User service requires an active logged-in, awake host for unattended work; do not infer execution while asleep. |
| Environment server updates/restarts/crashes | Persisted thread/workspace state remains, but live provider/process-bound state needs reconciliation. |
| Provider needs approval while no client is present | It can wait; disconnect is not approval. Pending process-bound requests cannot all survive a server restart. |
| Connection fails after a command was accepted | The event/receipt machinery supports idempotent command identity; transport reconnect alone does not blindly replay mutations. |

[Service guide][service-guide] [SSH implementation][ssh]
[Recovery implementation][recovery] [Connection runtime][connection-doc]

### Server restart is recovery, not preservation of every live object

The current v2 orchestrator commits events, projections, command receipts and
effect-outbox entries in one transaction. Accepted-command acknowledgement
means durable intent; it does not mean the provider action has completed.
Effects tied to a dead provider cannot simply be replayed as if their original
process still existed. [Event sink][event-sink]

Recovery reconciles unfinished runtime state before admitting new work. It marks
lost sessions stopped, cancels/retires affected runtime work, and expires or
cancels pending process-bound runtime requests. Persisted asynchronous questions
whose response capability is an application message are deliberately preserved.
Accepted queued runs retain order and execution identity but become held until
explicit resumption. [Recovery][recovery] [Recovery tests][recovery-tests]

There is an opt-in **Continue threads after restarts** setting. Its default is
off. The implementation requires eligible saved native continuation state and
matching provider identity; it does not assume any thread can restart. When
enabled, a durable continuation can submit a new “Continue where you left off”
message or a note about lost background work. Newer user work, prior delivery,
archival/deletion and changed provider identity prevent inappropriate automatic
continuation. [User contract][updates] [Continuation implementation][continuation]
[Continuation tests][continuation-tests]

Thus the persistence claim is narrower than “no state is ever lost”: durable
conversation/workspace state can survive, and supported provider conversations
can continue, while pending tools, terminal commands, approvals and live process
state may not. The host still needs a startup mechanism; automatic continuation
does not install one.

## 12. What persistent storage buys, and what it does not

T3 stores application-owned orchestration history in its environment database,
with provider-native identifiers/bindings needed for continuation. Clients keep
caches and, on mobile, an offline draft/attachment/message outbox. Those client
copies are not the authoritative record of already accepted remote execution.
[Architecture][architecture] [Mobile outbox contract][composer]

Durable command identities and transactional receipts help distinguish “retry
the same submission” from “start a second turn.” The connection layer explicitly
does not automatically replay mutations. This should not be translated into an
exactly-once guarantee for arbitrary shell commands or external side effects.
[Event sink][event-sink] [Connection runtime][connection-doc]

The snapshot includes provider switching, native/portable forks and portable
context handoffs. Those should not be confused with cross-machine migration:
the portable-handoff guide describes conversation selection for provider changes,
restart and forks, not automatic transfer of the workspace and authoritative
thread to another environment. The remote architecture continues to bind each
project/thread to one environment. No general cross-environment live-thread
migration workflow was identified in the reviewed paths; this is a bounded
source finding, not proof that no adjacent experiment exists anywhere upstream.
[Portable handoffs][handoffs] [Remote ownership][remote-architecture]

## 13. Network and authorization boundaries worth retaining

Each environment issues its own scoped sessions. Pairing can delegate/narrow
capabilities but cannot grant more than the issuer may delegate. Cookie, bearer
and DPoP-backed sessions share that authorization model; RPC methods require
specific scopes. Bearer/DPoP clients obtain short-lived WebSocket tickets rather
than placing a long-lived credential directly in a socket URL.
[Environment authentication][auth]

Connect adds a trusted broker. The relay authenticates the cloud user and asks
the linked environment to mint a bootstrap credential bound to the client's
proof key. The client exchanges it with that environment. Proof binding protects
against credential reuse, but the relay's signing authority remains trusted.
This is not equivalent to YA's encrypted relay trust model. No YA-style
application-content encryption layer was established in the reviewed Connect
flow; do not describe the two as interchangeable merely because both say
“relay.” [Connect trust boundary][connect-architecture]

Access to an environment is also not automatically a confined project sandbox.
The execution account and provider permission/sandbox choices determine what
its tools can do. Repository identity is presentation/routing metadata, not a
filesystem authorization boundary.

Finally, version compatibility has two layers: individual features use
capabilities, but the orchestration protocol must match. A mismatch refuses the
connection and requests a client/server update. The system supports independently
installed versions; it does not promise arbitrary cross-version compatibility.
[Protocol check][compatibility] [Update guide][updates]

## 14. A concrete end-to-end example

Consider a Linux development machine and a laptop used only as a viewer.

1. Install/configure Git, the chosen provider and GitHub access on Linux.
   These are credentials of the remote account, not products of QR pairing.
2. Install/start T3 there as a user service with the documented lingering setup.
   Link it with Connect, or establish a direct/private route and pair the client.
3. In the client, select that environment and add its existing repository or
   clone one into a directory there.
4. Create a thread with a worktree based on the desired branch. If fresh remote
   state is needed, use the origin-start behavior. Setup scripts execute there.
5. Submit the task. The remote server records intent, launches its local provider
   and records the resulting thread state.
6. Close the laptop. The Linux owner keeps running accepted work. An approval
   can wait or be answered by a separately connected phone.
7. Reconnect. T3 catches the client up using persisted state/replay; it does not
   need to copy a new transcript back into a laptop-owned session.
8. Inspect the remote diff, commit/push and create a PR using that environment's
   tooling. Fetch the resulting branch on the laptop separately if wanted.

This example uses the independent-service mode deliberately. Replacing step 2
with desktop-managed SSH changes the lifecycle caveats in sections 4 and 11.

## 15. What this clarifies for Yep Anywhere

Existing YA documents already distinguish the alternatives:

- [Managed remote executors](../../topics/managed-remote-executors.md) and
  [plan 119](../tactical/119-managed-ssh-executor-baseline.md): controller-owned
  identity/catalog, injected runner, source sent from the controller, projected
  Codex auth and returned Git/transcript data. The accepted implementation is
  still operator-only and does not promise live-turn survival on controller loss.
- [Cross-host delegation](../../topics/cross-host-delegation.md): independent
  target YA sessions with an explicit supervision/grant relationship.
- [Working across machines](../../topics/multi-machine-architecture.md): these
  are different ownership choices, not interchangeable SSH transport options.
- [Agent Auth Router](../../topics/agent-auth-router.md): credential/inference
  routing is separate from session ownership; the current integration excludes
  remote executors.
- The [remote file-view gap](../../gaps/remote-session-project-views-use-local-files.md)
  and [provider-neutral executor gap](../../gaps/sketches/provider-neutral-remote-executors.md)
  remain relevant constraints, not problems pairing alone solves.

| Question | T3's reviewed answer | Choice still open for YA |
| --- | --- | --- |
| Who owns the remote conversation? | Target environment server | Target-owned session versus controller-owned remote execution |
| Where does source come from? | Target checkout/clone and ordinary Git | Preconfigured target repository versus controller-mediated transfer |
| Where do credentials live? | Normally on the target environment | Target login, reachable AAR, or bounded projected credentials |
| What is SSH for? | Bootstrap a server and/or forward application traffic | Carrier for a subordinate runner, or access to an independent service |
| What happens when the laptop disappears? | Independent environment continues; managed SSH has cleanup caveats | Explicit lifetime policy, approvals, retained output and reattachment |
| How does work come back? | View it remotely; ordinary commits/push/PR/fetch | Remote-only work initially versus automatic incoming-head integration |
| Does repository grouping move work? | No; new-thread placement is separate | Keep grouping, placement and migration as distinct concepts |

**The most transferable simplification is to accept a prepared remote
development environment and keep the selected workspace authoritative there.**
A first YA experience could use a configured repository on that machine, start
a fresh branch/worktree, run the agent and let the user inspect/commit/push
remotely. Automatic source shipping, return integration and conversation
migration need not be prerequisites.

That interpretation does not choose whether the target runs a complete YA
server or a smaller independently persistent provider/workspace service. T3's
evidence supports the ownership model; it does not prove YA needs its entire
workbench, event store or cloud service. A thinner host would still need remote
files/Git, durable session identity, output retention, approvals, versioning and
an unambiguous attach/stop contract.

If AAR supplies remote inference, the router's location must be part of the
lifetime decision. A sleeping owner laptop cannot be the only route to the
next model request while promising autonomous remote completion. Choosing
target-owned credentials or an always-available router addresses that dependency;
an SSH reconnect mechanism alone does not.

These are implications for discussion, not a newly approved plan or a change
to [YA's roadmap](../roadmap/README.md).

## 16. Evidence limits and experiments that would resolve them

The source establishes the intended ownership and the concrete implementation
paths above. It does not measure production reliability or user satisfaction.
The most useful later live checks, if comparing a YA prototype, would be:

| Experiment | Evidence to record |
| --- | --- |
| Independent service, accepted turn, laptop sleeps | Remote provider identity, completion/approval state, persisted output and same-thread reattachment |
| Desktop-managed SSH, sleep then stale-tunnel recovery | Whether finalizer stop runs, whether the server/provider is replaced, and whether recovery submits a new continuation |
| SSH into an existing service, then remove connection | Existing remote server stays alive; no accidental ownership transfer |
| Blank target with SSH but no Git/provider credentials | Pairing succeeds independently; clone/provider failures identify the missing authority |
| Dropped response after accepted input | Same command identity yields one accepted turn; no duplicate external action is inferred solely from RPC retry |
| Server restart while approval/queue/background work exists | Process-bound requests retire, durable questions remain where supported, queued work is held, opt-in continuation is distinguishable from a surviving turn |
| Same repository on two machines with divergent files | Files/diffs/commands stay tied to the chosen environment and exact workspace |

Relevant inspected test suites include [SSH lifecycle][ssh-tests],
[runtime reconciliation][recovery-tests], [restart continuation][continuation-tests],
and the tests adjacent to the cited connection, project and stream modules.
No passing live result is asserted here.

The broader [September T3 comparison](t3code.md) remains a historical snapshot.
In particular, its absence claims about forks, external-session import and
scheduling must not be carried forward as current facts: this checkout contains
native/portable fork paths, agent-session scanner/importer modules and scheduled
tasks. This review updates the remote-execution analysis, not the entire feature
comparison.

[revision]: https://github.com/pingdotgg/t3code/tree/fed41fa88bb27cb4325cb208d571393850bc63c2
[architecture]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/internals/overview.md
[remote-architecture]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/internals/remote.md
[remote-guide]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/remote-access.md
[install]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/install.md
[pair]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/cli/pair.ts
[connect-cli]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/cli/connect.ts
[connect-architecture]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/internals/t3-connect.md
[auth]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/internals/environment-auth.md
[ssh]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/ssh/src/tunnel.ts
[ssh-tests]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/ssh/src/tunnel.test.ts
[ssh-command]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/ssh/src/command.ts
[desktop-ssh]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/desktop/src/ssh/DesktopSshEnvironment.ts
[source-guide]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/source-control.md
[github-provider]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/sourceControl/GitHubSourceControlProvider.ts
[github-cli]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/sourceControl/GitHubCli.ts
[github-routing]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/client-runtime/src/state/pullRequestRouting.ts
[github-permissions]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/client-runtime/src/connection/githubRoutingPermissions.ts
[clone]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/sourceControl/SourceControlRepositoryService.ts
[clone-tracker]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/project/ProjectCloneTracker.ts
[grouping]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/client-runtime/src/state/projectGrouping.ts
[launch]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/ThreadLaunchService.ts
[git-core]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/vcs/GitVcsDriverCore.ts
[project-settings]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/project-settings.md
[checkpoints]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/checkpointing/CheckpointStore.ts
[balance]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/client-runtime/src/load-balancing.ts
[balance-hook]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/web/src/hooks/useLoadBalancedEnvironment.ts
[runtime]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/runtimeLayer.ts
[sessions]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/ProviderSessionManager.ts
[connection-doc]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/internals/connection-runtime.md
[supervisor]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/client-runtime/src/connection/supervisor.ts
[compatibility]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/packages/client-runtime/src/connection/compatibility.ts
[thread-stream]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/ThreadStream.ts
[event-sink]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/EventSink.ts
[service-guide]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/background-service.md
[recovery]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts
[recovery-tests]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.test.ts
[continuation]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/RestartContinuation.ts
[continuation-tests]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/apps/server/src/orchestration-v2/RestartContinuation.test.ts
[updates]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/updating.md
[composer]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/composer.md
[handoffs]: https://github.com/pingdotgg/t3code/blob/fed41fa88bb27cb4325cb208d571393850bc63c2/docs/user/portable-handoffs.md

# Managed Remote Execution User Journey

> Run a familiar Codex session on a selected Linux host, preserve its native
> session and workspace there, and bring committed work back through a durable
> controller-side inbox without requiring target-side provider or upstream Git
> credentials.

Topic: managed-remote-execution-user-journey

Status: agreed product direction. The isolated-worktree baseline is tracked by
[tactical 119](../docs/tactical/119-managed-ssh-executor-baseline.md).
Persistent-checkout adoption, safe synchronization, and direct fast-forward
integration are recorded here as intended follow-ons until a tactical step
explicitly brings them into implementation scope.

Related:
[managed remote executors](managed-remote-executors.md),
[managed runner execution targets](managed-runner-execution-targets.md),
[source control](source-control.md),
[project directory storage](project-directory-storage.md),
[vanilla defaults](vanilla-defaults.md), and
[remote-session project-view gap](../gaps/remote-session-project-views-use-local-files.md).

## Product Promise

Remote placement changes where Codex and the project workspace run without
turning the session into a second YA server, account, or session type the user
must learn. The ordinary path is:

```text
select a Linux target
  -> work in a normal Codex conversation
  -> ask Codex to commit
  -> YA fetches the changed head without moving local files
  -> review Incoming work
  -> fast-forward main when it is safe
```

The canonical visible identity remains the controller's YA session id. Codex's
thread id, the SSH carrier, the injected runner, the target workspace, the
isolated transcript mirror, and the controller tracking ref are supporting
coordinates rather than new user-facing session identities.

The feature is default-off. **This server** remains the New Session default,
and disabling managed remote execution performs no target discovery,
inspection, synchronization, or background work.

## 1. Enable And Inspect A Target

The user enables **Managed remote executors** in Settings and selects an SSH
configuration alias. The existing system SSH configuration continues to own
the hostname, account, key, jump-host, host-key, and transport policy.

Read-only inspection reports whether the target has the first release's
requirements: Linux, Git, the runner runtime, and the supported Codex CLI. It
also verifies that the controller has the supported file-backed ChatGPT
subscription login. Inspection does not install software, create a workspace,
or contact an upstream Git forge.

The controller remains the subscription-auth owner. It projects a short-lived
per-lease access token to target Codex and services refresh requests through
the controller. The target never receives the refresh credential, complete
Codex credential store, API keys, or provider configuration, and it writes no
provider auth file.

## 2. Choose Where The Session Runs

New Session keeps **This server** selected. Opening **Run on** shows only
sanitized configured targets. Selecting a target performs read-only preflight;
pressing **Start** is the first action allowed to install a runner artifact or
prepare a workspace.

The first public provider is Codex. Choosing a target does not silently switch
providers, retry locally, or reuse the released Claude-specific SSH executor.

The session also chooses one of two workspace strategies.

### Managed worktree

This is the safe default. YA creates a unique target Git worktree at the
controller project's exact committed `HEAD`.

- Staged, unstaged, and untracked controller changes remain local and are
  disclosed as excluded before launch.
- The target needs no existing checkout or upstream Git credential.
- One session owns the worktree and its writer lease.
- YA may remove the worktree only after its cleanup contract proves that no
  dirty or unfetched result would be lost.

This strategy suits disposable VMs, parallel work, and targets whose directory
layout should not be part of the project configuration.

### Existing checkout

This is an explicit project/target mapping to a persistent target directory,
for example:

```text
linux-dev -> /home/user/code/yepanywhere
```

YA stores the opaque binding in controller app data and revalidates the target
path, repository identity, branch, `HEAD`, and workspace ownership before each
launch. It never guesses a target path by rewriting the controller path.

Codex operates directly in that checkout, retaining its installed dependencies,
build caches, services, ignored files, and existing Git state. YA never resets,
cleans, stashes, switches, or deletes a borrowed checkout. Only one YA-managed
active session may bind to that directory at a time; an external shell can
still mutate it, so every consequential operation rechecks its expected state.

A dirty borrowed checkout may be used as-is after explicit disclosure. The
user accepts that a later agent commit may include preexisting changes because
YA cannot reliably attribute overlapping uncommitted edits to different
authors.

## 3. Optionally Fast-Forward A Persistent Checkout

An existing checkout may remember **Safe sync before start** for its
project/target mapping. This means synchronization from the controller's
committed branch tip, not filesystem copying and not a general `git pull`.

YA transfers the exact controller commit to a temporary target-side YA ref,
rechecks the target immediately before mutation, and updates the currently
selected target branch only through Git's fast-forward-only operation.

| Observed relationship | Safe-sync result |
| --- | --- |
| Same commit | Make no change. |
| Target is behind | Fast-forward the current target branch and verify the resulting `HEAD` and worktree. |
| Target is ahead and already contains the controller commit | Do not rewind; disclose the target-only commits and allow an explicit start from that head. |
| Histories diverged | Make no change; offer use-as-is, a managed worktree, or manual reconciliation. |
| Tracked target changes exist | Make no change. |
| An untracked path would be overwritten | Let Git refuse the update and leave the checkout unchanged. |
| Branch, head, repository identity, or lease changes during preflight | Abort and return to launch review. |

Safe sync never creates a merge commit, rebases, force-updates, stashes,
cleans, switches branches, or contacts the target checkout's upstream. Local
controller changes outside its committed tip remain excluded.

## 4. Review And Start

The launch review presents effects rather than implementation jargon.

For a managed worktree it shows:

- target and observed platform support;
- Codex and subscription-auth readiness;
- exact committed base and excluded controller dirty counts;
- the isolated workspace effect;
- the incoming-work retention effect; and
- cleanup behavior.

For an existing checkout it additionally shows:

- verified target path and branch;
- target `HEAD`, dirty state, and relation to the controller commit;
- the proposed safe-sync result, if enabled; and
- the fact that YA never deletes or silently repairs the checkout.

A failed or changed preflight retains the draft prompt and selection. It never
falls back to local execution or performs a different workspace strategy.

## 5. Work In The Session

After launch, the conversation behaves like an ordinary controller-owned Codex
session. A compact location marker identifies the target and workspace mode,
but the user sends messages, handles approvals, interrupts work, and reads the
transcript through the normal session surface.

Codex and its provider-native rollout run on the target in the selected
workspace. Complete rollout suffixes are copied at bounded checkpoints to an
isolated controller app-data mirror for cold viewing. The target rollout
remains authoritative for resume; the mirror is never inserted into the
ordinary local Codex sessions directory or passed to local Codex for resume.

Session-entered file actions use the recorded target workspace or fail as
remote-workspace actions. They never display a similarly named file from the
controller checkout. Project controls without a location-correct contract
remain unavailable.

## 6. Observe Work At Verified Idle

YA does not scan Git during streaming and does not poll an idle workspace.
After a provider turn reaches a verified idle edge, it coalesces duplicate
lifecycle events into at most one workspace checkpoint.

The checkpoint is tiered:

1. Read the target `HEAD` through the existing runner channel.
2. Fetch Git objects only when that head changed.
3. Inspect dirty state when the turn had project-affecting tool activity or the
   user explicitly requests refresh.
4. Bound and time-limit the dirty inspection so an unusual repository cannot
   indefinitely hold session completion.

A purely conversational turn may therefore perform no Git work or only the
small head comparison. Explicit **Refresh** and a best-effort
graceful-shutdown checkpoint provide additional observations; neither creates
a background watcher. Merely opening Incoming work reads its durable local
registry and does not contact every target.

An unchanged head transfers no Git objects. A changed head is fetched through
the controller's SSH authority into the assigned private tracking ref and
verified before YA reports it as current. This never moves the controller's
checked-out branch or worktree.

If the target has uncommitted changes but no new commit, the session says so.
The user can continue working or ask Codex to commit; YA does not manufacture a
commit, stash, patch, or dirty-worktree archive.

## 7. Discover Incoming Work

A successfully fetched head appears in three connected places:

- The originating session shows a prominent compact status such as **Remote
  work ready · 2 commits**, with **Review** and the available integration
  action.
- The session-list row carries a small unresolved-work marker so closing or
  forgetting the session does not hide the result.
- Project **Source Control** owns the durable **Incoming work** inbox and its
  unresolved count.

The hamburger menu may link to the inbox and hold secondary actions, but it is
not the only place actionable work is exposed.

Incoming work is not an inventory of every remote session. Its default **Open**
view contains one current entry per managed session when that session has:

- a fetched head not yet confirmed integrated or resolved;
- last-observed uncommitted target changes;
- a synchronization failure that may be hiding work; or
- an unavailable target with unresolved last-known state.

Entries sort by most recent work activity. The initial page is a bounded 20
lightweight records, followed by cursor-based **Load more**; commit details and
diffs load only when opened. A collapsed **Recently integrated** view sorts by
resolution time. Sessions with no work do not enter this inbox. Archiving a
session does not remove its unresolved entry, and a new fetched head reopens a
previously resolved entry and moves it to the top.

Each entry identifies the target and originating YA session, base and fetched
head, relation to the intended local branch, last observation, dirty and sync
state, and available actions. Last-observed remote state is labeled stale when
the target cannot currently be checked.

## 8. Bring A Safe Result Into Main

The intended common integration action is **Bring into main**. It is a narrow
fast-forward operation, not a merge or conflict-resolution engine.

Immediately before acting, YA verifies that:

- the fetched head and its Git objects still match the incoming-work record;
- the selected destination is the expected local branch;
- the local worktree and index are clean;
- the destination tip is the expected value; and
- the destination can fast-forward to the fetched head.

If all checks pass, the explicit action fast-forwards the branch, updates the
working tree, verifies the result, and marks that exact fetched head
integrated. It does not push upstream.

If any check fails, YA changes nothing and reports **Needs integration**. The
advanced paths are:

- review the fetched commits;
- create an ordinary named branch at the fetched head;
- open or instruct a local agent to resolve the integration;
- copy the private tracking ref for manual Git work; or
- explicitly mark that exact head resolved when the user integrated it by an
  equivalent operation such as cherry-picking.

YA does not automatically merge, rebase, cherry-pick, resolve conflicts, force
an update, or push. The existing upstream **Pull** action keeps its existing
meaning.

## 9. Preserve The Work Without Making Metadata The Work

The user-facing pending state has three durable layers:

1. Session metadata identifies the managed execution coordinate and supports
   session routing and resume.
2. A project-indexed incoming-work registry in YA app data records target,
   workspace, base, announced and fetched heads, dirty observation, sync state,
   timestamps, and exact resolution disposition.
3. The private Git ref and imported Git objects hold the committed work itself,
   subject to the project-storage authorization approved before that writer
   ships.

The registry does not persist an unqualified `hasPendingWork` boolean. An exact
`resolvedThroughHead` or equivalent disposition lets a later fetched head
reopen the same session entry. Whether a fast-forward is currently possible is
derived from the recorded Git objects and destination branch at read or action
time.

The app-data registry, not transcript scanning or target polling, supplies the
inbox, count, order, and pagination. On restart, YA verifies that a recorded
tracking ref still resolves to the recorded fetched head. Missing or mismatched
state becomes a visible recovery condition rather than disappearing from the
inbox.

## 10. Resume, Disconnect, And Recover

- Closing the browser does not terminate the server-owned session.
- A graceful controller-server or development reload stops the baseline
  runner. Opening or sending later explicitly resumes the same target Codex
  thread in the same recorded workspace.
- A target reboot stops the runner. When SSH returns, YA revalidates the
  workspace and lease before resuming; it never assumes the old writer died
  merely because the connection disappeared.
- Already fetched commits remain locally reviewable and integrable while the
  target is offline.
- An unavailable or lost target workspace makes its unfetched commits and
  dirty-only files unavailable. YA reports that distinction and never claims
  the controller mirror can resume the provider or recover project files.
- If an existing checkout's repository, branch, or head changed outside YA,
  resume pauses for a new review rather than resetting or switching it.
- An SSH drop after launch acceptance leaves ownership uncertain until YA can
  prove the runner stopped or fence the previous generation. It never starts a
  second writer optimistically.

Terminating a session stops its provider and runner but does not discard
incoming work. A managed worktree is removed only after clean, fetched state
and the cleanup policy permit it. An existing checkout is never removed by YA.

## Delivery Boundary

Tactical 119's current baseline deliberately lands the lower-risk slice first:

- manual SSH, Codex-only placement;
- a controller-created isolated managed worktree;
- controller-owned subscription projection;
- target-authoritative resume plus isolated transcript viewing;
- verified-idle head synchronization;
- fetched committed heads presented as Incoming work; and
- review, copy-ref, and originating-session navigation without moving a local
  branch.

The complete journey records the intended follow-ons so the baseline does not
paint itself into a corner:

- adoption of a user-selected existing checkout;
- opt-in safe fast-forward synchronization before launch;
- the fast-forward-only **Bring into main** action;
- named-branch and local-agent integration conveniences; and
- richer inbox history and recovery controls as real usage establishes their
  necessary retention bounds.

Those follow-ons require their own compatibility, storage, mutation, and live
acceptance decisions. Linking them here defines the product direction; it does
not silently expand an implementation gate that still excludes them.

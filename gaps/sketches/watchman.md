# Watchman as a cross-platform filesystem subscription backend

Status: researched dependency candidate; installation, implementation, and
changes to monitoring defaults are not authorized.

## Recommendation

Evaluate **Meta Watchman as an optional external dependency for YA's live
filesystem observation**, starting with Source Control worktrees. It supports
Linux, macOS, and Windows and offers a shared daemon, incremental queries, and
subscriptions. This is a stronger candidate than extending YA's own
per-directory watcher machinery merely to restore native macOS/Windows live
monitoring. Actual resource and correctness benefits remain to be measured.

Initially require Watchman only when the user selects a Watchman backend;
keep YA installation and core use independent of it. Automatic selection,
bundling, or making it universally mandatory would be separate decisions after
platform validation. Retain bounded polling/manual refresh as explicit degraded
modes. Never label an incomplete or disconnected subscription authoritative.

Research checkpoint: 2026-09-26, upstream documentation and GitHub release/issue
metadata, plus YA source inspection at
`7c1dff9c369230cc0be415a2b31614ecefa39dc2`. No Watchman executable was found
on this host; no daemon was installed or started, and no benchmark was run.

## The service jj supports

[Jujutsu v0.45.1 configuration](https://github.com/jj-vcs/jj/blob/v0.45.1/docs/config.md#filesystem-monitor)
explicitly supports `fsmonitor.backend = "watchman"` to find changed paths
without rescanning the complete working copy. It requires a separately
installed Watchman executable. `jj debug watchman status` checks that setup.

There is a distinct optional setting,
`fsmonitor.watchman.register-snapshot-trigger = true`, that registers automatic
jj snapshots on filesystem changes. Merely using Watchman does not require
that behavior. YA should subscribe directly for observation, not enable jj
snapshot triggers or run jj commands on every event. This refines the default
command-time snapshot model in the [jj sketch](jj.md): background recording
is possible when the user deliberately enables this integration.

Watchman is independently useful for plain Git and non-VCS directories.
Its [README](https://github.com/facebook/watchman#support) identifies Meta's
source-control team as the primary maintainer, supports Python/Rust/JavaScript
clients, and uses the MIT license. This is a maintained specialist service;
that evidence does not by itself establish that its YA integration is correct.

## Platforms and distribution

| Platform | Upstream support | YA decision still needed |
| --- | --- | --- |
| Linux | inotify; supported builds for recent Ubuntu/Fedora | Compare with YA's already-measured bounded Linux path; account for kernel watch limits. |
| macOS | FSEvents; supported builds, community Homebrew package | First high-value test target after YA's native watcher exhaustion incident. Verify desktop packaging and service lifecycle. |
| Windows | Windows 10 64-bit and later; supported builds | Native Windows verification, executable distribution, connection/permissions, rename and case behavior. |

The [installation documentation](https://facebook.github.io/watchman/docs/install)
warns against assuming reliable results on remote/distributed filesystems and
says weekly release packaging can omit binaries. A live check of the
[latest release](https://github.com/facebook/watchman/releases/tag/v2026.09.21.00)
returned `v2026.09.21.00` with no attached assets. Do not promise a downloadable
binary for every platform from that tag. Select and verify actual artifacts
before proposing a bundled installer. Upstream describes BSD/Solaris support
as no longer actively maintained; they are not acceptance targets here.

## Why it fits YA

[Source Control's live-worktree contract](../../topics/source-control.md#optional-live-project-worktree-ownership)
currently permits native watches only on Linux. macOS/Windows default Off and,
when enabled, reconcile by polling. The historical
[resource-safety tactical](../../docs/tactical/113-live-worktree-resource-safety.md)
records the macOS FSEvents registration explosion and subsequent containment.
Watchman could replace that low-level observation responsibility while YA keeps
coverage, source projection, client leases, and publication ordering.

Current owners to preserve or deliberately replace:

- `packages/server/src/projects/projectWorktreeSubscriptionManager.ts` owns
  project subscriptions, Linux-only native acquisition, reconciliation,
  budgets/circuit breaking, and client snapshot/delta delivery. Start here.
- `packages/server/src/watcher/SharedDirectoryWatcher.ts` already shares
  native watches by canonical directory with independent leases and a budget.
  Watchman would add sharing across cooperating processes, not introduce
  in-process sharing for the first time. Do not run both backends over the
  same scope accidentally.
- Provider `FileWatcher.ts`, project-path caches, and open viewers are possible
  later consumers, with separate coverage and lifetime requirements. Do not
  migrate all watcher users as part of the first experiment.

Watchman's [subscriptions](https://facebook.github.io/watchman/docs/cmd/subscribe)
deliver an initial matching set and settled change batches over a live
connection; a remembered clock can resume from known observation state.
[Project watches](https://facebook.github.io/watchman/docs/cmd/watch-project)
consolidate overlapping roots, potentially sharing work with jj and editors.
That could reduce repeated scanning and registrations. Filtering a subscription
does not imply that the daemon crawls or watches only those matching files.

The [Skip sketch](skip-session-tracking.md) explores maintained derived state.
Watchman could supply filesystem inputs beneath that layer, or beneath YA's
existing caches without Skip. Neither dependency implies the other.

## Integration constraints to resolve before adoption

**Coverage and resumption.** Key the adapter by canonical root, backend
generation, and requested scope. Respect Watchman's returned root and relative
path: `watch-project` may choose an ancestor. Admit only roots whose actual
observation extent is authorized and within budget; avoid creating a broad
ancestor watch merely to discover it is unsuitable. Keep opaque source clocks
separate from YA's `{ epoch, sequence }` delivery protocol. Use initial state
plus cursor-based updates without a query/subscribe gap. A daemon restart,
cancelled root, expired history, recrawl, or `is_fresh_instance` response needs
explicit replacement/reconciliation, including removal of cached deleted files.
An empty fresh-instance result must never mean “nothing changed.”
[Query response semantics](https://facebook.github.io/watchman/docs/cmd/query).

**Filesystem facts, not an edit journal.** Coalesced notifications do not
identify the writer or preserve every intermediate file content. Re-read exact
files with YA's version fences; preserve transcript append/truncate/replace
handling if those consumers migrate. Git refs/index/linked-worktree metadata
and `.jj` metadata need explicit coverage. A content subscription alone cannot
establish repository status. Keep content ignores distinct from metadata needs;
do not assume Watchman query filters implement YA's Git-ignore contract.

**Project writes.** Synchronized Watchman queries can create temporary
[cookie files](https://facebook.github.io/watchman/docs/cookies) inside a root
or its VCS metadata. This must be reconciled explicitly with
[App data only](../../topics/project-directory-storage.md#default-contract),
not hidden behind the fact that a dependency did the write. Query
`sync_timeout: 0` is documented to avoid that query's cookie synchronization,
at the cost of a possibly lagging view; it is a candidate, not proof that an
entire subscription/daemon lifecycle makes no project writes. Audit every
selected operation. Do not create `.watchmanconfig`, edit ignores, or enable
snapshot triggers automatically. If the required mode cannot meet current
policy, obtain a specific policy decision before implementing it.

**Daemon ownership and quiescence.** Closing a connection removes subscriptions;
it does not guarantee immediate removal of root watches. Watchman can persist
watches across restarts and normally reaps eligible idle watches after five
days. YA's current last-lease contract cannot be satisfied merely by closing
its socket. Compare two deliberate designs: reuse an operator-owned daemon
with explicitly accepted residual observation, or use a YA-owned daemon whose
watches/resources YA can release. The former offers sharing with jj; the latter
offers stronger lifetime control but duplicates observation. Never delete a
shared watch or shut down the user's daemon to clean up YA. No ownership
choice is settled by this sketch.

**Resource and failure accounting.** Include the daemon's RSS, CPU, descriptors,
kernel watches, initial crawl, retained index, and recrawl work in the budget.
Moving that cost outside Node is not reducing it. Watchman documents overflow
recrawls and resource-exhaustion “poison” states that fail requests across
watches. Preserve [YA's resource mandates](../../topics/architecture-mandates.md),
bound queued deltas/reconnects, surface degradation, and never turn failure into
repeated daemon spawning or full-tree scans.
[Troubleshooting](https://facebook.github.io/watchman/docs/troubleshooting).

**Known interaction worth testing.** Jj
[issue #9818](https://github.com/jj-vcs/jj/issues/9818), still open when checked,
reports a macOS snapshot-trigger loop with split FSEvents and cookie-induced
directory events in a very large repository. This is an author-reported
configuration-specific failure, not a reproduced failure of plain Watchman
subscriptions. Test coexistence without enabling that optional trigger; ignore
administrative noise without suppressing real parent-directory changes.

## Small discriminating evaluation

Use isolated fixtures and separately owned daemon state. Before benchmarking,
follow the project's performance and process-cleanup procedures.

1. Exercise YA's actual worktree snapshot/delta path with Watchman and the
   existing backend on Linux, macOS, and native Windows. Include small trees,
   large ignored/generated trees, monorepos, and linked Git/jj workspaces.
2. Verify writes, atomic replacement, rename/delete, root replacement, case-only
   rename, symlinks, edits during initial hydration, reconnect, daemon death,
   fresh instances, overflow/recrawl, and resource exhaustion. Compare each
   accepted snapshot with an independent bounded filesystem/Git observation.
3. Verify storage and lifecycle contracts: no unapproved project writes;
   selected-root containment; no jj snapshots; Pause/Off/disconnect release;
   shared jj/editor clients remain functional; no YA-created orphan watches,
   daemon, retries, or background scans remain after teardown.
4. Measure total YA-plus-daemon cost, registrations, scans/subprocesses,
   update-to-visible latency, false invalidations, and idle behavior. Keep
   sequential typing responsive during file churn; show every keystroke within
   the existing 100 ms requirement. Compare cold acquisition and warm sharing
   separately so an already-running daemon does not hide setup cost.

Adopt the optional backend if it replaces meaningful watcher/reconciliation
complexity and improves the measured platform trade-off while preserving these
contracts. A good macOS/Windows result can justify platform-specific use even
if Linux gains little. Broader dependency or default changes follow evidence,
not this research note. No roadmap priority changes here.

Opened 2026-09-26 at the user's request for a separate Watchman dependency sketch.
Contributing-model: gpt-6-astra

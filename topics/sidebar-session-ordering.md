# Sidebar Session Ordering

> Sidebar rows follow the user's visits and submissions. Background output
> and agent activity changes update row content without changing chronology.

Topic: sidebar-session-ordering

See also: [ui-architecture](ui-architecture.md),
[session-list-hidden-duplicates](session-list-hidden-duplicates.md),
[session-liveness](session-liveness.md), and
[scrollback-view-stability](scrollback-view-stability.md).

## User chronology

The sidebar's **Starred**, **Last 24 Hours**, and **Older** sections order loaded
sessions by the most recent explicit session visit or composer submission in
this browser. Direct sends and deferred queue submissions count, including a
submission whose delivery fails. Passive assistant output, tools, heartbeat
turns, metadata refreshes, and active/idle transitions do not count.

Opening a session records a visit. A parked session page does not record visits
while another route is foreground. Sending to or queueing text for a session
records the interaction before delivery, so upload or provider delays cannot
change its relative time. New sessions enter through normal navigation.

For sessions without recorded interaction, creation time supplies a stable
initial order. Missing creation times sort last; session ID breaks ties.
General `updatedAt` is never used as evidence of user activity. Last 24 Hours
and Older use the same user/creation timestamp, so background work cannot move
a session between them. Active and queued sessions keep their badges and
duplicate-hiding protection without being pinned above other rows.

## Interaction hold

Entering the sidebar with a pointer, focusing a control inside it, or starting
a touch captures the displayed session identities, order, and section
membership. Status, title, unread, draft, and queue decorations remain live.
New arrivals, duplicate regrouping, and user-driven reorderings wait until the
interaction finishes. Rows no longer present in the loaded data are removed;
the hold never retains a stale navigation destination after removal.

The hold covers the whole sidebar, including the navigation area above the
session list, so approaching a row does not require hitting its exact bounds.
Pointer exit releases its interest; focus leaving the sidebar releases keyboard
interest. Touch keeps its target through the click, releasing after that click
or cancellation. Reordering resumes only when no interaction remains. Closing
or collapsing the sidebar, or switching connected sources, clears the hold.

## Storage and ownership

`sessionInteractionOrder.ts` keeps up to 1,000 latest distinct session
interactions per connected source in browser-local storage. Same-tab consumers
share the existing local-storage store; other tabs receive storage events.
Invalid persisted entries are ignored. If persistence is unavailable, the
existing storage helper retains coherent in-memory state. Clearing browser
storage or eviction of an old entry restores that row's creation-time fallback.

This is browser-local chronology over the server's loaded collection, not a
whole-history user-message index. Another device, provider-native terminal, or
agent-mediated session message does not update it. Existing server query
coverage and pagination still determine which sessions are available. No new
endpoint, capability, schema field, polling loop, or project-directory writer
is introduced.

`useSidebarSessionOrder` owns sidebar ordering and date classification above
the collection records. Shared collection selectors retain their existing
semantics for other consumers. Duplicate grouping preserves the resulting
order; it protects active, queued, current, owned, and lineage-related rows
under the existing duplicate-hiding contract. `useHeldSidebarLists` holds layout
identities independently of fresh row data.

A minimized desktop sidebar or closed mobile sidebar still releases its feed
interest under the existing sidebar-feed contract. Interaction tracking adds
no server demand.

## Design decisions

- **User activity owns chronology** (vs. active-first partitioning or general
  update recency): even a stable order within an active block jumps when a turn
  finishes. Activity is a badge, not a ranking signal.
- **Browser-local visits and submissions with creation-time fallback** (vs.
  inferring human activity from transcript timestamps): this uses known user
  actions without a new server contract. Cross-device history is deliberately
  outside this implementation.
- **Hold identities while refreshing data** (vs. freezing whole row objects):
  click targets stay stable while status and title changes remain visible.

## Verification

The summary-store Sidebar regression reproduces a row jumping when one active
session finishes while another produces output. It now preserves order and
updates the title. Component and hook coverage checks interaction holds,
arrivals, duplicate protection, persistence, source isolation, malformed
storage, and bounded retention. The browser test drives actual navigation and
composer submission, injects activity through the WebSocket boundary, checks
the target's position and navigation, and captures desktop and phone layouts.

## Historical active-first ordering (superseded)

Before commit `7fc9d17c` ("Client: hide duplicate-title sessions behind
(N hidden) expanders"), the sidebar rendered `recentDaySessions.map(...)`
directly and inherited the hook's stable order, so active sessions did not
shuffle. That commit introduced `groupDuplicateSessions`, whose
`visible.sort((a,b) => updatedAt desc)` re-sorted the *entire* recent list —
including active rows — on every refetch, defeating the hook's preservation and
reintroducing the every-few-seconds shuffle for concurrently-active sessions.
The `(N hidden)` feature is the regression vector the user suspected; splitting
active rows out of that path is the fix.

After the session collection migration, Starred briefly regressed the same
contract by sorting all starred rows by `updatedAt`. Active starred rows could
therefore trade places during a turn. The selector now uses the same active-
first stable ordering as Last 24 Hours.

The next refinement closed a more subtle jump: sorting active rows by
`activeStartedAt` descending made every idle-to-active transition become the top
row in its section. The stable contract is active-first partitioning, not
"newest active wins", so active rows now sort by `activeStartedAt` ascending.


The user subsequently clarified that only their activity should move rows.
The current user-chronology contract above replaces these active-first rules;
the historical fixes explain why sorting on provider updates was repeatedly
insufficient.

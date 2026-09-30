# A shared session cannot say who did what

YA now has a superuser and optional named limited users with project-level
grants and attributed usage. That delivered slice does not provide the
participant attribution across every collaborative surface proposed here. The
[participatory live share sketch](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share)
proposes shared discussion, owner-reviewed suggestions, and scoped guest input,
and the
[multi-machine map](../../topics/multi-machine-architecture.md#multiplayer-and-participatory-sharing)
records that real multiplayer needs restricted principals. Between those two
lies the common need: stable, displayable participant attribution on a trusted
server, distinct from the credential and grant that authorized the action.

Zed's Delta presents teammates as "first-class participants" in one thread
([analysis](../../docs/competitive/deltadb.md)); its authentication is a
hosted account. YA's household case (one server, a few trusted people or
devices) does not need accounts to get readable attribution.

## Desired behavior

- **Seat.** Each connected client can claim a seat name (a short display
  name and a stable client-generated seat id), stored per browser profile and
  offered once on first use, as an initial presentation candidate. A seat is
  display identity, not authority: it grants nothing and revokes nothing.
  Shared writes must be attributed server-side to the authenticated participant,
  not trusted merely because a request supplies a seat id or display name.
- **Attribution.** With a seat set, the server records the seat on each user
  send, queued message, steer, tool approval/denial, review comment and
  submission, transcript margin note, session discussion, and explicitly shared
  live-share draft or proposal. Private notes keep their audience. The
  transcript, queue rail,
  source-review sites, and Inbox show the seat where a second seat has ever
  appeared on that session; a single-seat session renders exactly as today.
  Each recorded input also keeps its authorization kind (driver send,
  send-enabled guest send, driver-applied guest proposal, tool approval), so
  [turn-anchored edit provenance](turn-anchored-edit-provenance.md) can
  attribute an agent's edit to the person whose ask produced it and the
  authority it ran under.
  Owner-applied suggestions retain both the suggestion author and applying
  owner, including which revision was edited and which action delivered it;
  editing a colleague's proposal must not replace its original authorship.
- **Provider-neutral and non-invasive.** The seat lives in YA metadata beside
  the canonical turn id
  ([provider user-turn durable identity](../provider-user-turn-durable-identity.md)),
  never inside provider transcript text or system reminders, so provider
  caches and resume are unaffected. Public read-only shares show seats only
  if the share creator opts in.
- **Presence.** An explicitly shared live-share draft stream and the session's
  active-viewer state are candidate places to carry the seat, so "someone is
  typing" can become "Kyle is typing". This does not claim synchronized guest
  drafts are implemented. Publishing draft text is explicit and distinct from
  private account-scoped draft synchronization.

## Relationship to principals

Seats make authority decisions legible, but cannot substitute for principals.
Grants attach to authenticated participants; seat names label their actions.
The [principals and grants](../../topics/principals-and-grants.md#session-collaboration-and-future-accounts)
proposal separates participant identity, membership, device keys, credentials,
and action grants. Verified account linking should preserve authorship across
invitation-based and account-backed participation without matching names alone.
This sketch owns display attribution; the collaboration sketch owns which
actions a guest may perform, and
[session notes and discussion](../../topics/session-notes-and-discussion.md)
owns human-only content and audience boundaries.

## Not yet decided

Whether a seat is per browser profile, per relay credential, or per paired
device; collision handling for duplicate names; and whether seats appear in
`ya-agent self` output so an agent can address a person.

Already decided (2026-09-15, maintainer direction): joiners of a multiplayer
share enter a username, the driver does not, and wherever a joiner may send
without the driver applying the text, the send is delivered with that
username as a visible prefix on the turn; an unprefixed turn is the driver.
See the
[participatory live share sketch](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share).
This sketch's seat generalizes that joiner username to drafts, approvals,
and comments that carry no provider-visible text, and to the driver's own
identity where a transcript has more than one person.

Found 2026-09-15 while comparing YA multiplayer sketches with Zed Delta.
Contributing-model: fable-5.1

# A shared session cannot say who did what

YA has one operator. A user turn, a queued message, a tool approval, a review
comment, and a live-share draft all carry no author, because until now the
author was always the person running the server. The
[participatory live share sketch](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share)
adds a driver and a guest composer, and the
[multi-machine map](../../topics/multi-machine-architecture.md#multiplayer-and-participatory-sharing)
records that real multiplayer needs restricted principals. Between those two
lies the smaller thing every collaborative feature needs first: a stable,
displayable identity per participant on a single trusted server.

Zed's Delta presents teammates as "first-class participants" in one thread
([analysis](../../docs/competitive/deltadb.md)); its authentication is a
hosted account. YA's household case (one server, a few trusted people or
devices) does not need accounts to get readable attribution.

## Desired behavior

- **Seat.** Each connected client can claim a seat name (a short display
  name and a stable client-generated seat id), stored per browser profile and
  offered once on first use. A seat is display identity, not authority: it
  grants nothing and revokes nothing.
- **Attribution.** With a seat set, the server records the seat on each user
  send, queued message, steer, tool approval/denial, review comment and
  submission, transcript margin note, and live-share draft or proposal. The
  transcript, queue rail,
  source-review sites, and Inbox show the seat where a second seat has ever
  appeared on that session; a single-seat session renders exactly as today.
  Each recorded input also keeps its authorization kind (driver send,
  send-enabled guest send, driver-applied guest proposal, tool approval), so
  [turn-anchored edit provenance](turn-anchored-edit-provenance.md) can
  attribute an agent's edit to the person whose ask produced it and the
  authority it ran under.
- **Provider-neutral and non-invasive.** The seat lives in YA metadata beside
  the canonical turn id
  ([provider user-turn durable identity](../provider-user-turn-durable-identity.md)),
  never inside provider transcript text or system reminders, so provider
  caches and resume are unaffected. Public read-only shares show seats only
  if the share creator opts in.
- **Presence.** The existing live-share draft stream and the session's
  active-viewer state carry the seat, so "someone is typing" becomes "Kyle is
  typing" and two people watching one session can see each other.

## Why before principals

Authority design (who may send, approve, edit files, publish) is the hard
part and is deliberately not decided here. Seats make every later authority
decision legible and testable: a grant can be attached to a seat, an audit
line can name one, and the driver/guest composer can label its two columns.
Without seats, even a read-only second viewer produces a transcript nobody can
reconstruct afterwards.

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

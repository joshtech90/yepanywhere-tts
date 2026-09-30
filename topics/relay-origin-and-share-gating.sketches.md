# Relay Origin And Share Gating Sketches

> Candidate share designs may extend a live transcript from read-only viewing
> into explicitly bounded multiplayer participation without granting ordinary
> YA operator authority.

Topic: relay-origin-and-share-gating

## Participatory Live Share

Status: **proposal, not implemented.** The 2026-09-30 maintainer discussion
narrows the initial direction to trusted colleagues discussing one live session,
then submitting suggestions for owner review, with optional direct prompting
later. This supersedes the earlier fixed driver/guest composer and v2/v3 delivery
sequence. It does not change the implemented read-only public-share contract.

The [multiplayer competitive analysis](../docs/competitive/multiplayer-ai.md)
records documented product precedents, permission differences, and evidence
limits. It does not select a dependency or change this proposal's delivery scope.

### Direction and scope

Every participant observes one live provider transcript; the server remains the
owner of provider execution and sequences accepted input. Participation does not
require another provider session, machine, or project-wide membership.

The proposed progression is:

1. **Human discussion.** Add a shared side-chat beside the live transcript.
   [Session notes and discussion](session-notes-and-discussion.md) owns the
   human-only content, including independently useful personal scratch notes.
2. **Reviewed suggestions.** Let participants submit proposed prompts that the
   owner can edit, dismiss, or approve. They never execute automatically.
3. **Direct prompting.** Explicitly grant particular participants narrowly
   scoped provider-input actions in this session.

Discussion can therefore be the first useful participatory share without guest
provider-input authority. Personal notes can land independently. These are
candidate delivery slices, not a ranked roadmap or implementation plan.

### Explicit participant grants

Use the vocabulary in [principals and grants](principals-and-grants.md): a
credential authenticates a principal; a target-enforced grant names the session,
allowed actions, expiry, and revocation. A display name, seat, or per-tab viewer
id does not grant authority. Model multiple participants and independently
revocable grants even if the first UI is optimized for an owner and one guest.

| Action | Proposed scope |
| --- | --- |
| View | Read this live transcript and the discussion admitted by the grant |
| Chat | Post human-only discussion; candidate baseline for admitted participants |
| Suggest | Submit a prompt for owner review without invoking the provider |
| Send | Submit a prompt directly when ordinary session state permits it |
| Queue | Add input to this session's execution queue |
| Steer | Change the active turn through the existing steer path; separately granted |

The first direct-input slice should stay with basic send and session queue.
Steer is a separate candidate permission, not implied by send or queue. Project
Queue is a later possibility needing its own resource and dispatch review; a
session input grant does not authorize scheduling other sessions or projects.

Guest input never implies changing bypass/permission modes, model or thinking
levels, answering tool approvals, stop/interrupt/restart, file editing, source
control, attachment upload, session creation/fork, or share management. Those
remain owner-only in this proposal. Any later expansion needs an explicit grant
and boundary review, not inheritance from a generic "write" role.

Expiry and revocation are enforced on the server for reads, writes, and live
subscriptions, not just hidden in the UI. Ending one participant's authority
leaves the owner session and provider process intact. What happens to already
accepted queued input on revocation remains an explicit lifecycle decision.

### Suggestions await owner review

A pending suggestion is a proposed prompt outside the execution queue. The owner
can edit or dismiss it, or approve it through their existing Send, Queue, or
Steer action. Approval consumes an exact suggestion revision once; a stale
approval cannot silently execute a newer edit, and retries or concurrent clicks
cannot create a second execution. Submission and approval are distinct from
proof that the provider durably received the input.

Keep the suggestion author, revisions/edits, applying owner, selected action,
and resulting input identity distinguishable. For example, "Suggested by Alex;
edited and queued by Kyle" must not collapse into a single author. A submitted
suggestion remains stable while its author starts another draft. Chat becomes
a suggestion only by a deliberate promotion action.

Reuse the ordinary session action rules and delivery feedback. Review the open
[unconfirmed-send gap](../gaps/unconfirmed-send-loss-across-reload.md) and
[durable turn-identity gap](../gaps/provider-user-turn-durable-identity.md) before
promising reliable acceptance/delivery or attribution across provider reloads.
Do not infer exact authorship by matching arbitrary transcript text.

### Attribution and provider-visible identity

Record authorship from the authenticated participant and retain display identity
as presentation metadata. [Named participant seats](../gaps/sketches/named-participant-seats.md)
owns the broader attribution proposal. Private notes are not published by
joining, and shared composer drafts are distinct from personal account drafts.

The 2026-09-15 maintainer direction remains: joiners enter a username; the owner
need not. Guest sends, steers, or queues that bypass owner review carry that
username as a visible prefix in provider input. Owner sends remain unprefixed.
Owner-applied suggestions need no guest prefix, but YA retains both suggestion
authorship and who applied the text. Provider-visible prefixes and trusted YA
metadata serve different purposes; a prefix is not authentication evidence.

### Presentation candidates

Reuse shared transcript rendering with a capability-limited participant surface
and an owner-side collaboration panel. Hide permanently unsupported controls;
disable an allowed control when session state makes it temporarily unavailable.
No guest permission-escalation request flow is proposed.

Chat, suggestions, and direct agent input need visibly distinct actions. A
participant has their own composer; an optional "me/them" or participant selector
can preview another person's explicitly shared draft. A participant strip with
presence, a desktop side panel, and a mobile pane with unread counts are
candidates. The former stacked/side-by-side composer layout remains an option,
not a requirement for the first version. Owner approval must be explicit and
must never consume a guest suggestion merely because the owner's composer is
empty or an alternate press gesture is used.

Later multi-composer layouts could use a small grid on wide screens and a stack
on narrow screens. The previous two-to-four-seat limit and owner-wider grid are
unselected sizing options, not protocol limits or automatic first-arrival
admission. Shared transcript state remains singular; drafts, suggestions, and
action results remain participant-scoped.

### Admission and transport

A temporary invitation bound on redemption to an enrolled client is a candidate
initial credential flow. One-time redemption, owner approval, reconnect leases,
key rotation/recovery, and grant inventory need a concrete design. Reuse the
[security-client audit](security-client-audit.md) concepts where appropriate;
its continuity key is not already a session guest credential. A browser's
non-extractable WebCrypto key does not establish OS-vault or hardware assurance.

The current public-share viewer token is only ephemeral tab identity. Public
bearer-link relay traffic is read-only and visible/modifiable to the relay
operator; adding a chat or input POST to that surface is not a secure interactive
grant. Before any writable collaboration ships, select either the authenticated
end-to-end encrypted relay path or a separately encrypted and authenticated
share channel. Reuse existing session-state/action owners rather than creating
a second provider state machine. Frozen and ordinary public live links do not
silently acquire interactive authority.

[Principals and grants](principals-and-grants.md#session-collaboration-and-future-accounts)
owns convergence on local or hosted accounts and email invitations. That future
login choice should not require replacing the collaboration's participant,
suggestion, or discussion records. No hosted account service is required by
this initial proposal.

### Later option: guest speech recognition

Guest recognition may eventually put text in the guest composer, following the
same suggestion and direct-input grants. YA-mediated recognition could also
provide a separately muteable live audio stream to the owner. Audio playback,
recognition partials, and final draft text are separate state; muting playback
must not discard text, and reconnect must not replay stale audio as live speech.
Direct browser-to-provider recognition does not promise YA-routed playback.

Microphone permission, playback policy, feedback prevention, retention,
credentials, and speech-credit delegation need a separate review. Current public
shares cannot spend server speech credits or borrow recognition credentials.
Speech and synchronized draft previews are later options, not prerequisites for
notes, chat, or reviewed suggestions.

### Margin notes: comments for human readers

Maintainer direction, 2026-09-15. [Session notes and discussion](session-notes-and-discussion.md)
owns the broader human-only space; margin notes add passage anchors and their
own presentation. They are not prerequisites for basic scratch notes or chat.
A participatory share carries **margin notes**: comments anchored to a transcript
passage that are visible to human viewers but invoke no user turn; nothing is
delivered to the provider. Text in
a session is often intended for human readers (a plan, a summary, an
explanation, a question to the team), and the natural place to discuss it is
beside it, without spending a provider turn or steering the agent. A note
becomes agent input only by a deliberate manual step: copy it, paste it, or
quote-reply it into a composer, which then follows the ordinary send, steer,
queue, and username-prefix rules.

- **Anchoring and layout** follow the
  [transcript margin notes](../gaps/sketches/transcript-margin-notes.md)
  sketch: wide layouts place a note beside its passage, narrow layouts above
  or below it, and streaming must not displace a reader. A note is visible
  inline without any expansion step; the first presentation to try is an
  inline pill that reflows with the passage text. The only toggle is
  presentation, showing a wider margin column versus collapsing notes back
  to pills, never hiding a note behind a click.
- **Attribution.** Every note carries its author's seat or username and time;
  the driver's notes carry the driver. Shared notes retain authenticated
  authorship within their collaboration scope, so permitted participants see
  them converge and reconnect does not duplicate or lose one. This does not
  select a common storage schema for notes, drafts, and suggestions.
- **Authority.** Writing a shared note requires admission and an explicit
  annotation grant, never provider-input authority. A display seat alone grants
  nothing. A transcript viewer may annotate only if separately permitted by
  the collaboration grant. Notes never reach the provider by themselves.
- **Single-player parity.** The same UI exists in an ordinary session with
  one participant, as private notes to self or to a later reader of the
  session. The share adds synchronization and authorship, not the feature.
- **Navigation aid for long sessions.** In both the share viewer and the
  session view, notes are a navigable index: a drawer listing every note in
  transcript order, and a keyboard path that reuses the existing message-list
  isearch (Ctrl+S / Ctrl+R / Ctrl+Alt+S, `useMessageListIsearch`) with a
  notes scope, so incremental search matches note text and jumps to the
  anchored passage. While that search is active the scrollbar turn rail
  (`UserTurnNavigator`) shows a notch per matching note with the note text as
  its preview, the same way it previews search matches today. Ctrl+N is not
  a candidate: it is the browser's new-tab key. A visible toggle opens the
  drawer for pointer and touch users; the session composer has a search
  button, but the share viewer still starts isearch only from the keyboard,
  recorded in
  [isearch has no touch entry](../gaps/isearch-has-no-touch-entry.md).
- **Persistence** is YA app-data beside the session, keyed by canonical
  session id and turn anchor, and survives compaction and forking with the
  transcript position it was anchored to; frozen public shares may include
  notes only at the creator's choice.

The open interaction question is the click target. Clicking a passage to
comment competes with the links and per-block controls the transcript
already owns, and the quote-comment gesture inventory in
[selection comment UI](selection-comment-ui.md) already reserves
type-over-selection, the selection action cluster, the selected-text context
menu, and the per-paragraph quote circle. Options: steal the plain click on
non-link text so a click anywhere in a passage opens a note; require a
deconflicting modifier (for example Alt-click on desktop, long-press on
touch) so ordinary clicks and links keep their meaning; or add a note action
beside the existing per-block quote circle and inside the selected-text
context menu, which needs no new gesture. The last two compose; the first is
the fastest for a reader and the most disruptive to link and control
targets. Decide with captures at desktop and phone widths before building.

### Open decisions

- Whether several independently revocable participant grants share one discussion
  room and suggestion list, and which history a newly admitted person may read.
- Invitation redemption, participant/device continuity, reconnect reservation,
  concurrent tabs, eviction, and owner-approved replacement devices.
- Expiry defaults and inactivity rules; pausing input without ending discussion;
  whether revocation cancels already accepted queued input.
- Suggestion retention after dismissal/application, edit ownership, and how much
  revision history remains visible. Human-only record lifecycle is coordinated
  with [session notes and discussion](session-notes-and-discussion.md).
- Provider-specific durable input mapping and retry/delivery receipts.
- Encrypted interactive transport and hosted-client capability/fallback review.
- Exact desktop/phone layouts, participant limits, shared-draft opt-in, and
  whether steer belongs in an early direct-input slice. Project Queue and
  speech remain later possibilities.

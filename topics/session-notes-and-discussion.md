# Session notes and discussion

> Proposal: a human-only space beside a session for scratch notes and shared
> discussion, with deliberate promotion into agent input when desired.

Topic: session-notes-and-discussion

Status: **proposal, not implemented.** Maintainer discussion, 2026-09-30,
identified side-chat as a useful first collaboration slice and independently
useful for keeping scratch notes on a session. This document owns that space;
the [Participatory Live Share sketch](relay-origin-and-share-gating.sketches.md#participatory-live-share)
owns participant admission, suggestions, and direct provider-input grants.
Neither document selects an implementation schedule or changes roadmap priority.

## Purpose and boundaries

A person can keep reminders, links, pasted context, questions, and rough prompt
ideas beside an ordinary session without spending a provider turn. With admitted
participants, the same kind of space supports human-to-human discussion while
everyone watches the live transcript. A shared discussion can be useful before
any guest has permission to prompt the agent.

Settled constraints for the proposal:

- Notes and discussion do not enter provider context, system reminders, agent
  summaries, or the provider-native transcript automatically. Posting, editing,
  or reconnecting does not wake, steer, or queue work for the provider.
- A person deliberately copies, quotes, or promotes content into their composer
  or a proposed prompt. Sending or approving that input follows the ordinary
  session action and authorization rules; writing chat grants no agent control.
- Personal notes must not become visible to another person merely because the
  session is shared. Sharing existing private material requires an explicit act.
- Records live in YA app data, associated with canonical YA session identity,
  rather than in the project directory or a YA-written shadow agent transcript.

## Candidate audiences and presentation

Two explicit audiences are proposed:

| Audience | Visibility |
| --- | --- |
| Private notes | The author alone, including during collaboration |
| Shared discussion | Participants admitted to that collaboration under its current read grant |

Writing shared discussion is a candidate baseline permission for admitted
participants, independent of permission to suggest or send agent input. Existing
public bearer-link viewers remain read-only; holding a public transcript link
does not admit someone to a writable discussion. An owner can manage participant
grants without publishing their own private notes.

The owner and participants need access to the same shared discussion from their
respective session views. A desktop side panel and a mobile pane with unread
counts are candidate layouts, not selected designs. Personal notes may be a
scratch field while shared discussion uses attributed entries; a common product
surface does not require identical editing or storage semantics.

Each shared entry should show its author and time. The server associates writes
with the admitted principal; a client-supplied display name is not proof of
authorship. A chosen display name remains useful presentation metadata. See
[named participant seats](../gaps/sketches/named-participant-seats.md) and
[principals and grants](principals-and-grants.md).

## From discussion to a proposed prompt

Chat, a suggestion awaiting review, and accepted provider input are distinct
states. A discussion entry may be promoted into a suggestion through an
explicit action; ordinary chat never becomes a suggestion by inference. The
owner may edit, dismiss, or apply the suggestion using an allowed session
action. Pending suggestions are outside the execution queue until approved.

Promotion retains a reference to the originating entry where available, its
author, and the person who promoted it. If the owner edits and applies the
suggestion, retain the suggestion author and the applying owner separately.
Detailed revision, approval, and delivery behavior belongs to the
[collaboration sketch](relay-origin-and-share-gating.sketches.md#suggestions-await-owner-review),
not a second submission mechanism in this topic.

## Relationship to margin notes and drafts

[Transcript margin notes](../gaps/sketches/transcript-margin-notes.md) attach a
human comment to a particular passage. Discussion is chronological and scratch
notes need no passage anchor. They can reuse authorship and persistence concepts;
a transcript reference on a discussion entry is a later option, not a
prerequisite for basic notes or chat. The margin-note sketch continues to own
anchoring, inline/margin layout, and passage navigation.

[Draft synchronization](draft-synchronization.md) already preserves unsent
personal fields across devices within an account. It does not implement these
notes, and its personal drafts are not a shared discussion channel. Reusing
local persistence and revision machinery must preserve the audience boundary.
Publishing live composer drafts is a separate, explicit collaboration feature.

## Persistence and lifecycle questions

"Scratch" describes how the space is used, not a decision to erase it on tab
close. The proposed behavior preserves acknowledged entries across reload and
reconnect and preserves unsent local text without blocking typing. Exact local
and server durability, offline recovery, edit conflicts, and limits require a
contract before implementation. Input must remain independent of transcript
rendering and synchronization, with each sequential keystroke visible within
100 ms under expected data volume and concurrent updates.

Open choices:

- Whether private notes are one editable document, separate entries, or both;
  whether shared entries support editing, deletion, and moderation.
- Retention defaults, explicit clear/expiry controls, and any recovery history.
  Access expiry and data deletion are separate decisions; their relationship
  must be stated rather than inferred.
- Whether a newly admitted participant sees all prior shared discussion or only
  material from their admission onward; whether several grants share one room.
- What remains readable after expiry or revocation. Server revocation cannot
  erase text a participant already copied or downloaded.
- Inclusion in exports and frozen shares, and behavior on compaction, fork,
  rewind, archive, or external removal of the provider transcript. Private notes
  are never included merely because the transcript is shared.
- Quotas, message-size limits, reconnect sequencing, and duplicate-write
  handling. No separate side-chat database or wire protocol is selected.

Any implementation must follow [project storage](project-directory-storage.md),
[architecture mandates](architecture-mandates.md), [vanilla defaults](vanilla-defaults.md),
and [hosted compatibility](remote-hosted-compatibility.md). Subscriptions and
retries need bounded owners and teardown; notes and discussion must not create
provider polling or keep an idle provider running.

## Proposed delivery direction

Personal notes can ship independently. Shared discussion is a candidate first
participatory-share version, followed by owner-reviewed suggestions and then
optional, explicit direct-input grants. This order offers useful collaboration
before guest provider authority or synchronized composer previews, but is not
a tactical implementation plan.

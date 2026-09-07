# Lightweight questions during active work

> A proposed one-shot question aside that answers beside ongoing work while
> keeping the composer attached to the main session, with explicit save or
> discard of the question and answer.

Status: v1 implemented. The [canonical topic](provider-agnostic-btw-asides.md)
owns the current observable contract. The original proposal and investigation
below remain design history; their future-tense implementation questions are
superseded by that contract and [conversation-context delivery](synthetic-turn-injection.md).
Candidates explicitly marked v2 remain proposals.

Canonical topic: [provider-agnostic /btw asides](provider-agnostic-btw-asides.md).
Related: [message controls](message-control-steer-queue-btw-later-interrupt.md),
[steering differences](steer-queue-provider-differences.md),
[synthetic-turn injection](synthetic-turn-injection.md), and
[provider fork support](provider-fork-support.md).

## Interaction and purpose

The main assistant is mid-turn. With this feature enabled, a submitted draft
whose literal last character is `?` opens a question aside. When the provider
cannot promptly receive and answer it through an isolated question mechanism,
YA could answer through a temporary fork of the main conversation. The main
work continues; the answer appears inline.

The trigger is exactly the final character of the raw draft, checked before
trimming or normalization. There is no semantic question classifier. A trailing
space is the user-selected escape: `Why?` triggers the card while `Why? `
uses ordinary main-session delivery, even while main is busy. Other suffixes
also fail the exact `?` test; `？` is not the ASCII trigger. When main is idle,
input follows ordinary delivery. Whitespace handling must not consume the
escape before deciding the route; afterward preserve the normal provider-text
contract rather than silently stripping the escape as a command token.

While the user is still composing, show a card placeholder as soon as the busy
session's raw draft ends in `?`: `Enter: quick answer · Space: keep typing`.
Place it above the composer, in a similar location to the eventual
answer card; it need not share the answer card's size or full layout. This
previews the route before submission, on desktop and mobile.
The mobile copy can name Send as the equivalent action. Enter or tapping Send
submits the question; the fork must not start merely because the placeholder
appeared. Space only inserts a space; it never submits or commits a routing
choice. The user can continue writing any number of sentences in the same
draft. Any edit that removes the final `?` removes the placeholder; ending
the draft in `?` again restores it. Recheck busy state and the entire raw
draft at Enter/Send. A space still present after the final `?` at that point
selects ordinary main-session delivery.

The first version is explicitly one question, one answer, then the user's
decision to retain the exchange or not. The answer appears as a card on both
desktop and mobile so the temporary interaction is visible. The card should
show `Enter to save Q+A` on desktop and expose tappable Save Q+A and Discard
actions on mobile; the empty composer send button performs that same save.
These labels are proposed copy, not a separate set of delivery mechanisms.

The intent is a lighter interaction than opening and managing `/btw`. A
temporary fork is an implementation possibility, not a new destination the
user must navigate. The composer always targets the main session after the
initial question has been routed. Typing never starts a follow-up in the fork.

| State / action | Proposed outcome |
| --- | --- |
| Question placeholder, draft ending in `?`, Enter or Send | Submit for one quick answer. |
| Question placeholder, type Space | Insert a space and keep composing; hide the placeholder, do not submit. |
| Completed answer, empty composer, Enter | Save Q+A into main context and dismiss the answer card. |
| Same state, tap the composer send button | Exactly the same save-and-dismiss action; expose a `Save Q+A` label or accessible name. |
| Tap Discard on the answer card, or press Esc while its dismissal action owns the key | Dismiss without adding the exchange to main context. |
| Type in the composer | Draft the next main-session message; never route to the fork. |
| Submit a nonempty draft | Send that draft to main through its ordinary delivery controls and close the answer flow without saving Q+A. |

To continue in main with the Q+A available, press Enter on empty first, then
type. To ask another question without retaining that context, ordinary main
input remains available. There is no interpretation of `ok` as an acceptance
command; it was only an early sketch of the save gesture.

The user explicitly selected Enter on empty and equivalent empty-send tapping,
then clarified that typing goes to main and selected one question/one answer
for v1. Esc or a new main message closes the flow without saving. Exact card
geometry, button copy, and whether closing begins on typing or submission
remain UI details to settle; the table uses submission. An empty
composer means no text, attachments, or pending input composition. Saving is
available only for a completed answer, and should require a fresh key press
rather than inheriting the Enter that submitted the original question.

## Difference from /btw

Existing `/btw` creates a continuing side work stream with its own conversation
and explicit composer routing. Its result injection is separately user-mediated.
This proposal reuses that isolation and potential fork machinery but removes
the continuing side-conversation interaction: one question, an answer card,
and save/discard. No focused-aside mode or child composer is entered.

Discard exits the answer interaction; the user was never composing into the
fork. Internal retention or archival of that helper is separate from whether
the Q+A enters main context. A deliberate `/btw` remains the existing route
for sustained side discussion.

A key such as Tab could eventually toggle continued side conversation, but
that is explicitly outside the first version. A mini-composer inside the card
is another possible later UI direction; its usefulness remains open. Neither
possibility changes the agreed one-shot v1 or makes ordinary typing enter the
fork implicitly.

## Possible v2: double-question-mark entry

An alternative entry gesture would let a first terminal `?` suggest that
typing a second `?` requests an immediate aside answer card. This addresses
users accustomed to typing `?` then Enter quickly, without pausing to notice
the preview. Under that alternative, a single `?` followed by Enter would
retain ordinary main-session delivery.

This is a candidate, not a change to v1's exact terminal-`?` trigger. Whether
the second `?` itself submits or arms Enter/Send, and whether it remains in
the question text, are unresolved. Idle-session questions remain ordinary
turns. The one-question/one-answer card and explicit save/discard decision
would stay the same.

## Possible v2: sidebar child-work tree

The sidebar's expandable subagent tree could expose in-flight question work
under its main session. V1 instead archives helper clones and keeps progress
in the answer card, without adding the continuing `/btw` relationship. A later
tree integration should distinguish temporary question work from provider
subagents and preserve the explicit save/discard decision. Restart/crash
persistence is not required for this interaction. A dedicated atomic server
route is also not required: client fork orchestration follows existing `/btw`.

## What saving means

Prefer preserving the user's question and the fork's subsequent assistant
answer text verbatim over generating a synthetic summary. If there were
multiple answer messages, retain their order and distinguish them from the
user's question. Preserve the fork origin and context boundary: main may have
continued since that snapshot. Append the exchange at delivery time rather
than rewriting main's history to pretend the answer preceded intervening work.

Verbatim text avoids summarizer distortion, but it does not make divergent
histories interchangeable. Save provides context; it is not approval to carry
out suggestions in the answer and should not ask main to answer the same
question again. The provider delivery mechanism must preserve that distinction.

Use native user/assistant history items when the harness supports them.
Otherwise, report the limitation and template the verbatim Q+A bundle into
a normal user turn. The capability describes how delivery happens rather
than simply allowing or denying Save. The template attributes the answer to
the aside and identifies the question as already answered; it does not pretend
that the entire answer was authored or instructed by the user. Ordinary-turn
delivery can produce another assistant response under normal send semantics.

Do not assume raw fork suffixes are portable just because their text is
verbatim. Tool calls need their matching results, and provider reasoning or
other opaque blocks have additional replay constraints. The initial candidate
is visible Q+A text with source attribution, not tool execution replay or a
general branch merge. Whether referenced evidence must accompany an answer
is an investigation question.

## Proposed provider surface for saving context

Use Codex's native `thread/inject_items` for the save action when available.
That operation provides the missing history insertion; it does not generate
the aside answer. The existing provider fork and session-start mechanisms
remain the starting point for isolated answer generation.

At proposal time, `AgentSession` in `packages/server/src/sdk/providers/types.ts`
exposes `steer` and its ordinary user-message queue, but no history-append
method. `AgentProvider.forkSession` supplies a separate fork primitive.
Following [provider abstraction](provider-abstraction.md), propose an optional
`AgentSession.appendConversationContext(...)` method for the missing action.
The name and precise types remain design candidates. Expose delivery semantics
such as native history insertion versus an attributed normal user turn; absence
of the native method selects the latter when ordinary input is supported.
The required behavior is:

- Accept an ordered, bounded sequence of text messages with explicit user or
  assistant roles, plus the source aside and fork boundary. Keep provider-native
  raw Responses items inside the Codex adapter rather than exposing them to
  the generic route or browser.
- Native history insertion does not submit a new user request, start an idle
  turn, or interrupt active work. Active work sees it when the harness next
  consumes pending context. The normal-user-turn capability instead uses the
  ordinary parent delivery controls and may start a turn or steer active work.
  Acceptance is distinct from proof that the model has already read it.
- Route through the incumbent provider-session owner, including the existing
  provider-host proxy/worker path. Do not open a second writer to the parent
  or mutate its transcript files behind the live harness.
- Return an explicit acknowledgement or failure. The save coordinator owns
  duplicate prevention and must not show Saved on a failed or ambiguous
  append. Provider acceptance, persistence, and visible transcript updates
  need a real-path probe before their receipt semantics are finalized.
- Never turn an absent native method into successful no-op. Declare and show
  the normal-user-turn limitation, then deliver its templated bundle through
  the usual send path. Capability must reflect the running harness and version,
  not merely the provider's name or `supportsSteering` flag.

For Codex, map text messages into `ResponseItem::Message` items and use
`thread/inject_items`. Prefer preserving the actual fork answer text and roles
over flattening them into user input. Fork provenance remains explicit even
when roles are preserved, since main has continued independently.

For providers without native insertion, ordinary user-turn delivery is the
user-selected fallback, not a reason to omit Save or require a manual copy.
Native role preservation and no-new-turn behavior must not be advertised for
that fallback. Claude's `shouldQuery: false` may offer a future intermediate
capability after verification, but is not required to use the ordinary-turn
fallback. Browser support must also follow the ordinary server-capability
compatibility review.

### Separate facility: assistant asks the user asynchronously

Kyle's motivating report concerned an assistant asking a question and then
continuing work that does not depend on the reply. That description matches
Codex's `request_user_input_async`, whose source is in
`codex-rs/core/src/tools/handlers/request_user_input_async.rs`. It runs in the
opposite direction from this user-initiated question card. YA preserves readable
questions and structured metadata but currently lacks dedicated answer controls;
see the high-priority [async question UI gap](../gaps/codex-async-question-answer-ui.md).
Existing `/btw` support does not establish support for that interaction.

The facility selected above is `thread/inject_items` for retaining Q+A, not
`request_user_input_async` for generating the user's quick answer.

## Provider findings

Source inspection on 2026-09-06; Contributing-model: 6-Astra. These are
original interface findings. The canonical topic records the later live
insertion probe and its limits; no latency comparison is claimed.

### Codex TUI and app-server

Inspected official Codex `rust-v0.153.3`, commit
`b1a547b1f73ce86205d9222ac19cff334b3b7a2e`, in the optional local
`references/codex` checkout. This is a pinned snapshot, not a claim about every
installed or newer Codex release.

- Normal TUI submission records a pending steer when an agent turn is running.
  No special handling for a trailing `?` was found in that path; answering a
  question and resuming work is model behavior, not a question-specific TUI
  response guarantee. See `ChatWidget::submit_user_message_with_history_and_shell_escape_policy`
  in `codex-rs/tui/src/chatwidget/input_submission.rs` and composer submission
  in `codex-rs/tui/src/bottom_pane/chat_composer.rs`.
- Codex has separate ephemeral side conversations; their boundary treats
  inherited history as reference and avoids continuing the parent task. See
  `codex-rs/tui/src/app/side.rs` and the `/btw` alias test
  `slash_btw_requests_forked_side_question_while_task_running`.
- App-server exposes `thread/inject_items`, whose `ThreadInjectItemsParams`
  accepts raw Responses items. Its handler parses them as `ResponseItem` and
  calls `CodexThread::inject_response_items`, documented as recording history
  without starting a new turn. Active-thread injection queues the items for
  the running turn; idle-thread injection records them directly. See
  `codex-rs/app-server-protocol/src/protocol/{common.rs,v2/thread.rs}`,
  `codex-rs/app-server/src/request_processors/turn_processor.rs`, and
  `codex-rs/core/src/{codex_thread.rs,session/inject.rs}`.

That app-server finding resolves the older interface-access uncertainty in
[synthetic-turn injection](synthetic-turn-injection.md) for this inspected
version. Actual YA integration, supported-version gating, transcript display,
duplicate prevention, and live-turn ordering remain untested.

### Model APIs versus agent harnesses

The major model APIs checked accept caller-supplied assistant history:
[OpenAI Responses](https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses)
accepts assistant-role input messages;
[Claude Messages](https://platform.claude.com/docs/en/api/http/messages/create)
accepts supplied user/assistant turns; and
[Gemini GenerateContent](https://ai.google.dev/gemini-api/docs/generate-content/text-generation)
accepts supplied user/model history. This establishes ordinary text-history
support, not arbitrary injection into a live coding-agent session.

The installed Claude Agent SDK `0.3.258` documents
`Query.streamInput(AsyncIterable<SDKUserMessage>)`, with user-role input rather
than an assistant-history append interface. `SDKUserMessage.shouldQuery: false`
is documented to append without triggering an assistant turn and merge into
the next querying user message. That is a promising attributed-envelope path;
it does not establish native assistant-role insertion or timely mid-turn
consumption. Source: the package's `sdk.d.ts`; no runtime probe was performed.

Do not generalize model API support to all YA providers. Other harnesses need
their own public-interface checks. Transcript-file surgery is not an assumed
fallback, and preserving real fork output does not remove that API limitation.

## Open design and investigation questions

- Verify every submission surface supplies the raw draft before trimming,
  including desktop Enter, mobile Send, and any speech/paste processing.
  Verify that the placeholder and actual route agree, including a main turn
  that finishes while the user is composing. Whether attachments are allowed
  needs a decision.
- Distinguish prompt delivery latency from answer latency. Steering support
  alone does not promise a prompt answer. Route before delivering to main;
  a timeout after accepted steering cannot safely assume the question was
  unseen and duplicate it into a fork and later back into main.
- Establish the fork's snapshot boundary while main is active, including
  unfinished tool calls. Prefer bounded, non-mutating question work. Verify
  latency, context fidelity, and cost before claiming the fork is cheaper or
  faster than steering.
- Specify the card's behavior while the answer is streaming or after
  reconnect, and the exact close-on-new-message gesture. Saving twice
  must not duplicate context; display should distinguish pending from saved.
- Verify each harness's no-new-answer delivery semantics and the visibility
  of imported roles. Keep a user request to act on the answer separate from
  retaining the exchange as context.

Automatic question diversion would be configurable and default-off under
[vanilla defaults](vanilla-defaults.md). The implementation request does not
change `/btw` or roadmap priority. The required server compatibility review
precedes changes to its wire contract.

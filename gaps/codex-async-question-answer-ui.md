# Codex asynchronous questions lack pending-question visibility

Priority: high (P1), explicitly requested by the maintainer.

YA supports readable text and transport/persistence for Codex
`request_user_input_async`, but does not expose its structured questions as
answerable controls. This is partial support, not a missing tool or a completely
lost question. Users can read the question and type an ordinary message, but
cannot select its supplied choices, answer through a question-specific control,
or see question-specific pending/submitted state.

The maintainer reports seeing `Q1:` questions and reasonably reading them as
plain text. The September 7 observation below now correlates a displayed
question with a confirmed async tool invocation; the prefix alone still does
not identify the tool that produced it.

Related contracts: [provider output](../topics/provider-output-contract.md),
[provider refresh](../topics/provider-refresh.md), and
[Codex question/permission mapping](../topics/codex-permission-mode.md).
This is separate from the proposed user-to-assistant
[one-shot question aside](../topics/provider-agnostic-btw-asides.sketches.md).

## Evidence and current behavior

Inspected YA at `bab9357c9` and official Codex `rust-v0.153.3`, commit
`b1a547b1f73ce86205d9222ac19cff334b3b7a2e`, on 2026-09-06.
Contributing-model: 6-Astra.

- Codex's `RequestUserInputAsyncHandler::handle` in
  `codex-rs/core/src/tools/handlers/request_user_input_async.rs` emits an
  `AgentMessage` with `delivery: async`, readable fallback text, and ordered
  structured questions. It returns `accepted: true` immediately so independent
  work continues. A later reply is ordinary user input; there is no outstanding
  `item/tool/requestUserInput` RPC to answer.
- YA's `CodexProvider.normalizeThreadItem` and `convertItemToSDKMessages` in
  `packages/server/src/sdk/providers/codex.ts` preserve the assistant text,
  provider item id, `codexAgentMessageDelivery`, and `codexAsyncQuestions`.
  `packages/server/src/sessions/normalization.ts` preserves the same metadata
  from the durable canonical `item_completed` event. The compatibility work
  landed in `dff8b3ea1`; this gap must not redo that normalization work.
- Neither `codexAsyncQuestions` nor `codexAgentMessageDelivery` has a consumer
  in `packages/client` or `packages/android` in the inspected tree. The shared
  `AppMessageExtensions` declares both, but no client rendering or answer path
  recognizes them.
- `SessionPage` renders `QuestionAnswerPanel` only for a
  `pendingInputRequest` whose `toolName` is `AskUserQuestion`. Its
  `handleQuestionSubmit` calls `api.respondToInput` with that pending request's
  id. The async assistant message does not create such a request. Reusing
  that RPC response path would be incorrect even if the visual controls are
  shared.
- The two focused existing tests pass without warnings:
  `renders asynchronously delivered agent messages` in
  `packages/server/test/sdk/providers/codex.test.ts`, and
  `keeps standalone async agent questions and skips ordinary duplicates` in
  `packages/server/test/sessions/codex-normalization.test.ts`. Despite the
  former test's name, it tests provider-to-SDK conversion, not browser UI.

Verification command:

```bash
pnpm --filter @yep-anywhere/server exec vitest run \
  test/sdk/providers/codex.test.ts \
  test/sessions/codex-normalization.test.ts \
  -t 'asynchronously delivered|standalone async'
```

Result: 2 tests passed, 155 deselected. This is a source-backed missing-client-
path finding with normalization checks, not a live browser/provider round-trip
reproduction. No runtime source was changed for this investigation.

## Confirmed live observation, 2026-09-07

Contributing-model: 6-Astra.

In Codex session `01a07aa1-1062-7342-ab8e-7781f81da6cc`, the agent called
`request_user_input_async` with a question about waiting for another YA session
or coordinating a handoff, and the options `Wait for it to finish` and
`Coordinate the handoff`. The tool immediately returned `accepted: true`.
The maintainer supplied a screenshot showing the question and both choices as
an ordinary Markdown bullet list without visible answer controls, then asked
whether the message was marked as an async question. The `Q:` prefix was
agent-authored text, not the structured discriminator.

The maintainer explicitly requested clickable choices: "it would be useful
in multi-choice for me to click the one i want". Treat supplied-choice controls
as requested delivery alongside pending-question visibility; do not leave
them indefinitely behind a count-only implementation. Preserve free-text
replies and the nonblocking lifecycle. An initial suggested selection must
never submit itself. The interaction may use click-to-send or explicit submit,
but must make sending intentional and preserve the answered question's context.

Current checkout `84891372f` still declares `AgentMessage.delivery` and
`questions` in the generated Codex protocol and preserves their normalized
fields in `CodexProvider`. This is a confirmed tool-call/screenshot correlation,
not a captured browser network trace or a verified answer round trip. The
screenshot remains in the originating session attachments; its readable
content and reproduction inputs are recorded here for a fresh checkout.

## Delivery requested by the maintainer

The minimum is an indication of how many unanswered questions the user has
not yet seen, especially recent questions that have scrolled away during
continued agent output. A small count near the bottom of the composer or at
the top center of the view could provide it; exact placement remains open.
The count should lead to the questions and their source context, with both
keyboard and tappable access. A count-only first delivery can be incremental,
but does not close the September 7 request for clickable supplied choices.

Keep unseen and unanswered distinct. Receiving or rendering a message does
not mean the user saw it; scrolling it offscreen does not mean it was
answered. Dismissing the floating list does not resolve its questions. An
optional presentation such as `3 pending · 2 unseen` could expose both counts,
but the minimum must make the unseen pending subset noticeable.

Define seen detection, the scope of "recent", and state across reloads or
multiple viewers before implementation. A proposed seen signal is actual
visibility of the question or its contextual preview, not merely DOM mounting
or receipt while a tab is hidden. Count individual questions, not message
envelopes. Ordinary free-form replies do not carry a provider answer id, so
answered-state association needs an explicit design; a random subsequent user
message must not clear every pending question.

## Minimum verification and subsequent coverage

1. Exercise the real client path with async questions arriving while later
   work streams. Verify the count for offscreen/unseen questions, discovery
   through the indicator, and separate seen versus answered state. Include
   multiple questions in one message, live/durable deduplication, reload, and
   desktop/mobile access.
2. Preserve normal agent progress and the main composer. Do not create a
   blocking input request merely to obtain an unanswered-question indicator.
   Ordinary blocking questions and approvals retain their separate behavior.
3. Any question-specific reply action submits an ordinary user message with
   the question identified, using steering while busy and ordinary sending
   after turn completion. Do not respond to a nonexistent input-request RPC
   or label a sent reply as proven provider consumption. Verify a late reply
   as well as an active-turn reply when adding that action.
4. Before claiming complete rich-answer support, cover supplied choices,
   free-text-only questions, multiple questions, retained drafts during output,
   and no automatic submission of a suggested/default selection. Run a bounded
   real-provider smoke; passing normalization tests alone is insufficient.

## Candidate interaction, not a settled layout

The maintainer suggested a pending-questions list toggled by a keystroke,
with a dismissible floating presentation and an anchor/preview of each
question's transcript context. A corresponding tappable toggle would make
the same list available on mobile. Dismissing the floating view need not
answer or discard its questions. Exact placement, shortcut, grouping, and
whether pending state is shared across viewers remain design choices.

Selectable supplied choices and free-text answer controls are requested
alongside the unseen-pending indication and access to context. They can land
incrementally; neither requires an elaborate generic form system.

An answer can be a formal text reply beginning with the question's tag and
enough of its title/context to identify the referent, delivered as steering
while the agent is busy or ordinary input after it becomes idle. This fits
the provider's existing ordinary-user-message reply contract. A tag such as
`Q1:` is text, not a provider answer RPC id; the async schema provides titles
and options rather than per-question ids. Avoid ambiguity when several
messages reuse a tag by retaining the source message association and quoting
the question as needed. Do not require the model to infer the referent from
a bare choice such as `yes` or `option 2`.

Likely approach: build an async-question adapter over the already-normalized
assistant fields and reuse bounded question-control presentation where useful,
with an ordinary-message submit callback. The existing question panel's
pending-approval lifecycle is not the async question lifecycle. Prefer existing
server fields and routes; any newly required client/server contract still needs
the normal compatibility review.

Not fixed in place because the request authorized investigation and a gap,
and correct closure spans answer UI, nonblocking lifecycle, delivery, and
live/durable behavior. It is not a one-line provider registration fix.

Found 2026-09-06 while distinguishing Codex assistant-to-user async questions
from YA's user-to-assistant question-aside proposal.

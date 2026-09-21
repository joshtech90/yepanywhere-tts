# No clear-based `/reriff` command for fresh creative alternatives

Status: proposed feature, not implemented or queued. User-requested gap,
2026-09-21. This records the YA wrapper; the portable `/riff` skill is separate.

## Missing behavior

After a creative response, invoking `/riff` in the same conversation leaves the
coordinator exposed to its original default attempt. The user wants `/reriff`
to capture the original creative request, clear back before that turn, and
submit it as an explicit fresh `/riff <request>` invocation. This avoids manual
copying and removes the original attempt from the model's live conversation.
The prior attempt remains available in YA's durable rewound history.

The portable workflow creates four candidates from the same brief and
random-string procedure, presents them, and lets the user choose a favorite
to refine. It supports UI, writing, roleplay, and technical documents.
Shell-generated strings are the initial default; explicitly requested
model-generated strings must be produced without tools or random-device reads.
Its benefit is not established by running the workflow.

## Existing owners and proposed integration

- [Session rewind](../../topics/session-rewind.md) owns cuts, provider support,
  busy/queue refusals, durable history, and first-turn behavior. Reuse
  `rewindSessionToCut` in `packages/server/src/routes/sessions.ts` and the
  client flow around `handleRewindCommand` in
  `packages/client/src/pages/SessionPage.tsx`; do not implement a second rewind.
- [Skill invocation](../../topics/skill-invocation.md) owns provider inventory
  and canonical invocation. [Emulated commands](../../topics/emulated-slash-commands.md)
  owns explicit YA transforms and command precedence. `/reriff` should invoke
  a **YA-shipped skill or a YA-shipped instruction injection**, not assume
  every installation happens to have the operator's personal `/riff` skill.
- The reference implementation is `skills/riff/SKILL.md` in the separate
  `graehl/agents` repository (operator checkout: `~/agents`). Research context
  lives there at `research/random-string-creativity/proposal.md`. Choose one
  maintained package/source for YA delivery, retaining provenance if vendored;
  neither that local checkout nor this prose is a runtime dependency.

The current rewind command dispatch handles `clear`, `fork`, and `clearloop`;
no `reriff` implementation was found. The existing turn-menu action **Clear
replacing this turn** already captures the before-turn cut and restores prompt
text as a draft; `/reriff` adds reliable payload preparation and riff dispatch.

## Proposed acceptance conditions

1. Capture the selected original prompt, attachments, and required retained
   context before clearing. Default to the relevant creative request; when YA
   cannot identify it reliably, let the user select a turn rather than silently
   clear a guessed span. A turn-menu entry could supply an exact source; any
   numeric syntax remains a design choice.
2. Resolve the **before-source-turn cut** through existing stable message/turn
   identities. `/clear N` keeps turn N and its response; the requested turn
   itself must be excluded. Do not assume visible turn positions or ordinal
   subtraction still identify a live predecessor after previous rewinds.
3. Resolve the shipped skill/injection and prepare the complete replacement
   payload before applying the cut. After success, submit exactly once using
   the provider's supported invocation form. Reconnects or failures must not
   lose the captured request or silently duplicate submission; a send failure
   after a successful clear leaves a recoverable retry with the prepared text.
4. Honor actual provider and server capabilities. Reuse current clear refusal
   behavior for active turns and pending input. Handle the first-turn/new-session
   case explicitly; do not claim in-place rewind where the provider cannot do
   it. Do not fall back to sending bare `/reriff` text after a refused clear.
5. Keep the transformation explicitly invoked. Preserve relevant user
   corrections when resolving a request across several turns, without passing
   the discarded assistant answer as inspiration. Show the chosen source/cut
   when ambiguity would make a different interpretation costly.
6. Describe this as a conversation rewind, not a filesystem rollback. Existing
   files and side effects remain; candidate isolation and starting-source
   selection belong to the riff workflow. No automatic deletion or restoration
   of earlier generated files.
7. Verify ordinary and attachment-bearing prompts, prior rewinds, the first
   turn, unavailable skill/injection, unsupported providers, busy/queued states,
   and retry after rewind-success/send-failure. Inspect actual provider-bound
   context to ensure the old answer is excluded and the original request is
   present. Apply the normal hosted-client compatibility review before wiring
   a new command/capability contract.

Not fixed in place because this request authorizes a tracked proposal, not YA
command implementation. It does not reprioritize the product roadmap.

Found 2026-09-21 while landing the portable riff skill and preserving the
random-string creativity research proposal.
Contributing-model: 6-Astra.

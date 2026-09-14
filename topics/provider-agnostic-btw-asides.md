# Provider-Agnostic /btw Asides

This topic covers YA-owned `/btw` side sessions and one-shot question cards:
short side requests that
should run beside a parent session without being treated as active-turn
steering, deferred queueing, or provider-native slash-command pass-through.

Related topic: [side session configuration](side-session-config.md) for
silent helper queries and lightweight fallback side-query envelopes.

## One-shot question cards

Question cards are a lighter entry than `/btw`: one question, one answer,
then an explicit Save Q+A, Continue /btw, or Discard decision. Enable **Quick question cards**
under Settings → Message delivery. The browser-local setting defaults off;
existing delivery remains unchanged until enabled.

The setting caption warns about observed Codex prompt-cache costs: as of
2026-09-08, all three measured Quick Answer forks had large misses, with
90–96% of input uncached. This is a 100% observed miss rate across requests,
not a claim that every input token missed or that all future forks must miss.
Native fork support alone does not establish inexpensive inference. The open
[fork cache-efficiency gap](../gaps/quick-answer-fork-cache-efficiency.md)
records the evidence and the provider improvements needed before reconsidering
the warning.

- While the main session is `in-turn` or `waiting-input`, an attachment-free
  draft whose literal final character is ASCII `?` previews a quick answer
  above the composer. Desktop says `Enter: quick answer · Space: keep typing`;
  touch says `Send: quick answer · Space: keep typing`. The preview starts no
  provider work. Eligibility is checked again on submission.
- The raw draft is checked before ordinary trimming. `Why? ` opts out;
  Space only inserts a space. Idle questions, explicit slash/`!!` commands,
  attachments/uploads, correction/fork-summary modes, and composers focused
  on `/btw` keep their existing delivery. Deferred speech submissions retain
  their original delivery intent. Providers without the existing `/btw`
  clone path do not show the hint.
- Submitting the preview starts an isolated clone using the existing
  clone/resume/read routes. Main keeps working. The child receives the exact
  question plus instructions to answer from inherited context, avoid commands
  and file changes, and avoid follow-up questions. This is a prompt constraint,
  not a new provider sandbox or a guarantee that a fork costs less than steering.
- The card belongs to its originating source, project, and session. Switching
  sources clears it even if the new host uses identical project/session IDs.
  Clone, metadata changes, resume, polling, transcript reads, Save, and cleanup
  remain bound to that source. A late clone is archived there; a late launch
  after dismissal is stopped there. A Save already underway may finish on the
  original host, but cannot refresh or change the newly selected session.
- The compact card occupies normal footer space immediately above the main
  composer, below queued items and other aside panels. It reduces the transcript
  viewport instead of covering recent activity. An already-following transcript
  stays at its live bottom as the available viewport changes. Readers who
  scrolled back keep their position. Long answer content scrolls inside the card
  while Save Q+A and Discard remain accessible. The card has no
  visible heading; its `?` help control explains the flow and save fallback.
  Action labels are centered within compact desktop buttons and larger touch
  targets on phones. Save uses a semibold label centered independently of its
  desktop shortcut, which sits outside the button. It displays only
  the child assistant's visible text after the marked question, in order;
  inherited answers, reasoning blocks, and tool execution are not imported.
  Typing drafts the next main message until the user chooses Continue /btw.
  The question card itself has no child composer.
- Once complete, a **fresh Enter on an exactly empty composer**, the empty
  composer Send button, or the card's **Save Q+A** button saves the exchange.
  Empty means no text, attachments, uploads, pending speech, or IME composition.
  Held/repeated Enter cannot save the answer automatically. Explicit card Save
  also works while the user has a separate main draft.
- **Continue /btw** is available after the answer completes. It unarchives
  the existing child, links it to this parent as an interactive aside, and
  opens the ordinary `/btw` conversation with the original question and answer.
  Moving starts no fork, model turn, or parent-context insertion. Follow-ups
  resume that same child and explicitly lift the one-question-only limit;
  they do not refork the parent's growing history. Controls prevent duplicate
  moves or dismissal during the metadata update. Failure retains the answered
  card with an error and allows an explicit retry. The existing metadata and
  `/btw` navigation contracts also work with older capable servers.
- **Discard**, Esc when the card owns dismissal, or submission of a new main
  message closes without saving. Typing alone does not dismiss. Dismissal
  stops unfinished child work; it never stops main. Saving already in progress
  cannot be dismissed or submitted twice. Failure is visible and does not
  automatically retry an operation whose acceptance may be uncertain.
- A failed card offers **Steer** to send the original question verbatim as an
  ordinary main-session message. It uses normal steering (or resumes main if
  idle), without starting another fork or including the aside instructions,
  answer, or error. A separate composer draft, quoted context, correction, and
  attachments stay untouched and are not included. The card closes only after
  send succeeds; on failure it remains available. Steer and Discard are disabled
  while sending. The card never automatically resubmits a failed steer.

Save preserves question and assistant text verbatim, with a separate provenance
message naming the child YA session and snapshot-request time. Main may have
continued since that snapshot. Saving is context, not authorization to carry
out the answer, and does not ask main to answer the question again.
The general [conversation-context contract](synthetic-turn-injection.md)
owns delivery: native insertion where supported, otherwise an attributed
normal user message that may receive a reply. The card's `?` help discloses that
fallback before Save and reports which delivery occurred afterward.

Only native-history delivery requires the new `session-conversation-context`
server capability. Older capable servers still answer cards through their
existing clone/resume/read routes, and Save uses their ordinary resume route.
No new endpoint is called when the capability is absent.

Codex and Codex OSS `/clone` requests use the provider's native `thread/fork`
adapter, including while the parent is working. YA reads bounded source
metadata but does not copy or parse the full inherited transcript to create
the child. Paginated Codex forks retain provider-owned history references;
provider context initialization still occurs. The clone inherits the source
sandbox boundary, leaves the parent running, and starts no question turn until
the existing resume request submits it. Native failure is reported directly;
YA never falls back to a handwritten Codex rollout copy. Claude retains its
existing storage-clone path.

The legacy `/clone` response keeps `messageCount` as a conservative inherited
prefix offset. For native Codex forks it is `Number.MAX_SAFE_INTEGER`, so old
`/btw` clients display no inherited messages before the marked aside prompt
arrives. Once that marker exists, it determines the child transcript boundary
regardless of the offset. This field must not be displayed as an exact count;
obtaining an exact inherited count must not cause a full-history scan. Quick
question cards already require their unique prompt marker to extract answers.

**Use native Codex forks instead of repairing copied filenames:** the provider
owns both resumable identity and paginated lineage. Renaming a handwritten
copy would retain the full-transcript cost and duplicate that ownership.

The browser owns this transient flow. Helper clones are archived before their
question starts, so normal session lists stay clear; they remain archived
sessions, not deleted transcripts. They have ordinary fork provenance and no
interactive `/btw` parent link until explicitly continued in `/btw`. They are not restored as cards after navigation,
reload, or browser crash. Polling is bounded to 160 visible checks spaced by
1.5 seconds, pauses while the page is hidden, and stops on completion or
unmount. Input requests, missing answers, and exhausted polling show failure
and request child cancellation. Browser crashes do not guarantee cancellation.
Sidebar child-work trees and continuing card conversations are v2 candidates
in the [sketch companion](provider-agnostic-btw-asides.sketches.md).

Verification covers real composer submission, the SessionPage browser flow at
1000×600 and 375×812, native and older-server Save, the route through `Process`,
and Codex app-server message insertion. A live Codex 0.153.4 probe persisted
user/assistant text without starting a turn; active-turn consumption timing and
live Claude fork generation were not exercised by that probe.

A 2026-09-07 live Codex 0.153.4 check exercised the corrected `/clone` route
and resumed its native child from the reported 179 MB parent. The child used a
24 KB paginated rollout and resumed successfully; it was archived without a
model turn. The reported storage clone failed the same provider resume check
because its rollout filename was not canonical.

## `/btw` contracts

- `/btw` is a YA routing command. It starts or focuses an aside session when
  YA has an explicit capability path for the provider; unsupported providers
  should not silently receive `/btw` as ordinary prompt text.
- Parent and aside sessions are separate work streams. The parent agent should
  not see aside prompts or results unless the user explicitly injects them.
- Result injection is a separate user action. It may insert into the composer,
  steer an active parent turn, or queue into the parent only through the normal
  parent-session delivery controls.
- Focused aside mode changes composer routing, not parent ownership. Parent
  liveness, queue state, and ongoing output must remain visible enough that the
  user can tell which work stream is active.
- Aside capability is provider-specific but the product model is
  provider-neutral: provider-fork, storage clone, native subagent, or
  resume-with-summary paths must all satisfy the same parent/child contract.

## `/btw` invariants

- `/btw` must not be a synonym for `turn/steer` or deferred queue. Those are
  separate delivery intents.
- A child aside must persist a parent link, and parent views must be able to
  hydrate visible child-aside state after reload.
- `parentSessionId` is the interactive Mother link, and new records pair it
  with `parentSessionKind: "btw-aside"`. Ordinary Clone/Fork/helper provenance
  is stored separately as `forkedFromSessionId`; a bare fork relationship must
  never activate the `/btw` badge, Mother navigation, or aside toolbar.
- Clients accept a generated custom title beginning with `/btw` as the legacy
  positive signal when connected to an older server. A bare legacy
  `parentSessionId` is not sufficient because older YA releases also used that
  field for ordinary Clone and Fork lineage.
- A pre-v3 aside whose generated `/btw` title was manually replaced is
  indistinguishable from an ordinary record with the overloaded parent field.
  Migration fails closed by treating it as fork provenance; new typed asides
  remain identifiable after retitling.
- UI affordances should show routing state before submission. If the composer
  is focused on an aside, the user should not have to infer that from a
  truncated title or hidden URL parameter.
- Completed or hidden asides remain findable in the parent timeline or aside
  list; they should not disappear solely because the child process ended.
- Provider-specific context cloning must be bounded and explicit. If a provider
  cannot fork cheaply, YA should expose that as a capability gap rather than
  replaying unbounded parent context by accident.

## Representative Change Types

- Adding provider capability flags or fork/clone orchestration.
- Changing `/btw` slash parsing, keyboard shortcuts, or composer routing.
- Changing aside parent/child persistence or hydration.
- Changing aside card/timeline rendering and focused-aside controls.
- Adding result insertion, steering, or queue-to-parent actions.

## Tests That Should Fail On Contract Regressions

- `/btw` on an unsupported provider does not silently enter the parent prompt.
- A focused aside routes composer sends to the child until explicitly exited.
- Parent-result injection requires an explicit user action.
- Reloading the parent session restores visible linked aside state.
- Deferred queue and `/btw` launch paths remain distinct.
- Clone/Fork rows with fork provenance do not render `/btw` UI, while a renamed
  aside with explicit `parentSessionKind` still does.

## Next Step: Normal Turn Renderer Adapter

Replace the current string-slice aside transcript model with a message-object
adapter into the normal session turn renderer. `/btw` panes and Mother inline
cards should pass child-session messages through the same user prompt,
assistant text, markdown, tool-call, and copy/selection controls that ordinary
session turns use, with only layout density and composer routing differing for
the aside surface. Keep the adapter role-preserving and explicit about Mother
versus child ownership so split view remains a view concern, not a second
greenfield transcript implementation.

## Wide-screen split pane (focused aside beside Mother)

On wide viewports (≥1100px), focusing a `/btw` aside opens a right-side pane
that mirrors the aside transcript next to Mother's messages. The pane is
collapsible — the user can hide it via a Hide button (which exposes a thin
vertical handle for re-expanding) without losing aside focus. While the pane
is visible, the focused aside's sticky card is hidden from the composer
footer to avoid duplication; collapsing the pane restores that card.

Composer ownership in the split layout: each pane owns its own composer.
Mother keeps the full footer composer (model picker, attachments, voice,
permission mode, deferred queue, etc.) but narrowed to the messages
column. The aside pane carries a minimal composer (textarea + Send,
Enter-to-send, anchored at the pane bottom so it remains visible while
the aside body scrolls). The minimal composer intentionally omits model,
attachments, voice, and permission affordances — only `/done` is parsed
client-side; other slash text is forwarded verbatim to the aside agent,
and users who need a full composer can collapse the pane to fall back to
the single-composer focus-routing model.

Contracts:

- Split pane affordance is opt-in by viewport width and focus. Mobile,
  narrow viewports, and unfocused state retain the existing inline aside
  cards above the composer.
- Hiding the pane (`btwSidePaneCollapsed = true`) must not change aside
  focus, queue state, or aside lifetime; only the right-pane render is
  suppressed and the sticky card returns. In the collapsed state the
  aside pane composer is unmounted, so Mother's footer reverts to
  routing into the focused aside (`mainComposerForAside` is true).
- When the pane is expanded the footer composer routes to Mother
  (`mainComposerForAside` is false). Aside turns go through the pane
  composer; Mother's draft and the aside's draft are independent.
- Closing the aside (Done button in the pane, the inline card's Done, or
  `/done` in either composer) must clear the focus and return the
  composer to Mother.
- Focus transitions reset the pane to expanded and clear the aside-pane
  draft (single-string, not persisted to localStorage in the initial
  ship); an explicit collapse only persists for the current focus
  session.
- Layout uses CSS grid on the `session-split-with-aside` container so
  messages occupy top-left, Mother's footer occupies bottom-left, and
  the aside (or its handle) spans the full-height right column. The
  underlying DOM remains source-ordered as messages, aside, handle,
  footer to preserve narrow-viewport behavior under the default
  flex-column.

## `/done` close-and-report command (in-aside)

`/done` is a YA-intercepted slash command available in an aside composer. It
closes the aside and reports back to Mother through the user-mediated draft
path. It is not sent to the aside agent. Argument shapes:

- `/done` (no argument) — minimal report. Long-term target: drafts into
  Mother's composer `> /btw <asideSessionId>: <original side request,
  truncated>`, no agent invocation. **Initial ship is close-only**: closes
  the aside with no Mother-composer draft, pending agreement on the value
  of automatic drafting.
- `/done <free text>` — long-term target: drafts `> /btw <asideSessionId>:
  <free text>` into Mother's composer, no agent invocation. **Initial ship**:
  closes the aside with a toast noting that report-back drafting is not yet
  implemented.
- `/done summary` (future) — sends a synthetic instruction to the aside agent
  ("produce a handoff-light report, 3-5 lines, paste-ready for the parent
  session"), waits for the response, then drafts that response into Mother's
  composer prefixed with a fork attribution. The user can cancel during the
  wait.
- `/done file [path]` (future) — writes the report (either the minimal form
  or the summary-mode output) to a temp file under the YA data directory and
  shows the path; useful for reports too long for a composer draft. Does not
  populate Mother's composer.

Contracts:

- `/done` follows the composer it is submitted from. The side-pane composer,
  the narrow footer while it routes to an aside, and either one's Done button
  close that aside and return focus to Mother. A wide-layout Mother composer
  continues to target Mother even while an aside pane is open.
- In the Mother composer, the separate synthetic-done setting owns only an
  enabled, exact, attachment-free `/done`. When that setting is Off, or the
  draft is otherwise ineligible for the synthetic action, `/done` remains
  provider text; YA does not reject it as an aside-only command.
- Report-back to Mother always goes through the autodraft-if-empty /
  clipboard-otherwise path; never auto-send a turn to Mother.
- After report-back is drafted (or copied), the aside is dismissed.
- The default `/done` and `/done <free text>` modes must not invoke the
  aside agent — they are pure client-side wind-down.
- `/done summary` is the only mode that issues a further turn to the aside
  agent; that turn must be tagged so it is visible in the aside transcript
  as a YA-initiated handoff request, not as an organic user message.

Open questions deferred until we agree on value:

- Whether the parent agent should be able to read the aside transcript when
  the user asks it to ("hand off everything that happened in that fork").
  Today the parent has no awareness of the aside; cross-session read would
  require new permissions and is intentionally out of scope for the initial
  `/done` ship.
- Whether `/done summary` should be available even when the aside provider
  cannot cheaply produce a short report (e.g., already context-exhausted).

## Future: manual compress-in-place on the forked transcript

Opt-in, user-triggered compression of an aside's cloned transcript (plus the
pending side request) before the aside agent's first real turn runs. Motivated
by long-parent forks where the full clone leaves little headroom for the
aside; manual rather than automatic so the user owns the fidelity/headroom
tradeoff per fork. Default `/btw` behavior remains full-clone with no
autosummary.

Sketched constraints to honor when this is built:

- Compression must not become the aside agent's first turn. Run it as a
  separate, tool-disabled model call whose only output is summary text; do not
  let the aside provider begin the side request until the rewritten transcript
  is in place.
- Compression input includes the cloned history and the pending side request,
  since directives often reference "the file we just edited" or similar —
  compressing only the history can strip the referents the directive depends
  on.
- The rewritten JSONL should contain a single synthetic turn carrying the
  summary, clearly labelled as a YA-generated compression (not as a parent
  assistant turn), followed by the side request as the normal user turn the
  aside responds to.
- Keep the pre-compression clone retrievable (or operate on a copy) so a bad
  compression does not strand the user with an unusable aside.
- Out of scope of `compact-and-handoff.md`'s auto-compact policy. That policy
  is a parent-side pre-send mitigation for one provider/model pairing; this is
  an aside-side, manual, opt-in path that does not share triggers, owners, or
  fallback rules with it.

# Conversation-view thinking row can squirm ~2px at ≥10Hz

While following the live tail, the whole transcript can bounce vertically by
about two CSS pixels, ten or more times a second, for ~15s. It stops when
assistant prose arrives. Repro is rare; the one captured case was a Grok 4.6
turn where Enter was sent during/just before thinking
(session `01a0a6dc-dc37-7a02-a678-95de175a9763`, ~2026-09-15T23:11:50–23:12:01Z).

Follow mode re-pins on every transcript height increase
(`MessageList` ResizeObserver). A 2px height oscillation of the last activity
row therefore moves every visible line.

## Ranked leads

1. **`--conversation-thinking-height` has no hysteresis.** The latest
   preview's `offsetHeight` is written to the row on every ResizeObserver
   tick and caps the previous card plus the activity list. A 240↔242 flap
   (subpixel rounding, wrap, or a 1px border) restyles siblings, which
   restyles the source, at observer cadence.
2. **Same-line test was a 1px ceiling.**
   `previous.top - latest.top <= 1` treated a 2px baseline wobble as a wrap,
   applied the stacked budget, and the next measure put them on the same
   line again. The drop path already kept a zero-height box to avoid a
   different flap; the shared-line test had no deadband.
3. **Per-token max-content width measure mutated live thinking text**
   (`display`/`width`/`maxWidth` in a `useLayoutEffect` on
   `preview.thinking`). That forced layout on the streaming path and could
   let a temporary height leak into the height publisher.
4. **Processing indicator line box is unpinned.** `.processing-text` has no
   `line-height`; `.processing-indicator--control-only` is 18px vs 20px.
   The typewriter is 25ms/char. Last-child geometry feeds `isAtScrollBottom`.
   Weaker: isProcessing was stable in the captured window. Left unfixed so
   this change does not grow the global stylesheet for a secondary lead.
5. **Grok live thinking is not a growing block.** `yieldUpdates` accumulates
   `agent_thought_chunk` and only flushes on a non-thought event, resetting
   the message id. ACP thought chunks in the window were sparse (~one per
   reasoning burst, 200–900 chars). Grok's own `events.jsonl` logged
   `streaming_reasoning` at 40Hz with duplicates; YA does not consume that
   file. Not the 10Hz client cadence, but it does dump a large card just
   before prose — the layout then has to settle.

## Mitigation in tree

Leads 1–3 are addressed in the same change as this gap: published thinking
height ignores ≤2px shrinks, the shared-line test uses a 1px/4px deadband,
and width is measured per block not per token. Leads 4–5 remain.

Live confirm is still outstanding — the captured burst is over. Re-check on
the next Grok 4.6 send-during-thinking episode before deleting this entry.

Found 2026-09-15 while debugging a granted live tab's ~2px follow-mode squirm.

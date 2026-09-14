# Vocabulary learning is fed only by replay scans, never by arriving messages

`VocabularyStore.observe` has exactly one caller: the scan loop in
`VocabularyLearning.ts:174`. Nothing feeds it when a message arrives from a
running provider. Every count YA has ever learned came from re-reading a
transcript file after the fact, and the committed contract in
[pluggable speech recognition](../topics/pluggable-speech-recognition.md)
describes only that path.

The online half is real and is not the gap. `DistinctiveTop` maintains a bounded
approximate top-N in memory, globally and per session, and `observe` updates it
per message with no disk read. That structure is exactly what a live tail wants.
It is simply wired to the wrong source.

## The contract it should have

- **A message arriving while collection is enabled qualifies. Full stop.** No
  timestamp comparison, no window. It arrived, collection was on, it counts.
- **Replay does not qualify on those terms.** Re-reading a transcript is gated
  by the look-back window as it is today, because a replayed message carries no
  evidence about when YA learned of it.
- **So `hours = 0` becomes meaningful**: collect the live tail while YA is up
  and read nothing back. Today zero collects nothing at all, verified by
  measurement — a scan's cutoff is computed when the scan runs, which is always
  after the message that triggered it, so both the session filter and the
  message filter reject it.

This retires the anchor I proposed in
[the seen-filter entry](vocabulary-seen-filter-may-be-redundant.md). A stored
"collect from this instant" was an attempt to make a window mean live arrival.
With a real live feed there is nothing to anchor: arrival is the qualification.
The window goes back to meaning only what it says, how far to replay.

## Where the seam is

YA already distinguishes the two. `subscriptions.ts` handles a provider message
at `:421` on the live path and replays buffered history at `:538`, where it
tags each message `isReplay: true` before emitting. So the fact exists; it is
just not recorded on the message itself anywhere durable, and that seam is the
wrong one to use because it is per client subscription. Vocabulary must not
learn only while somebody is watching.

The client-independent source is the process event stream, `Process.subscribe`
at `Process.ts:4500`, which the supervisor already consumes elsewhere. One
server-owned subscriber per process, feeding `observe` with an explicit live
flag, is the shape. Points to settle while building it:

- The live path must bypass the floor as well as the window, or a compaction
  that raised the floor into the present would start dropping arriving
  messages. The floor exists to stop a *replay* double counting.
- Deduplication still matters, because a live message will usually be replayed
  later by a scan of the same transcript. The fingerprint filter already
  handles exactly that, so live observations must enter it.
- Streaming deltas must not each count as a message. The live path needs the
  same finalized-message test the subscription uses, not raw deltas.
- Both heaps update, not just the session one. `observe` already does this:
  `considerWord` scores against the current total and offers the word to the
  global heap, and the session heap then takes the same score with the
  fivefold multiplier. Routing arrivals through `observe` therefore keeps the
  global 500 and the per-session 100 in step by construction, and any live path
  that skipped straight to the session heap would leave the global list frozen
  between scans.

Found 2026-09-11 after the maintainer pointed out that the online top-N was
specified to be fed by a live tail, and that no such feed exists.

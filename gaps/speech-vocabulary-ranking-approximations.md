# Speech vocabulary ranking and storage use approximations

Learned-vocabulary selection now keeps in-memory hash maps/sets and
snapshots them to files. Several ranking and persistence choices are
deliberately approximate so a scan cannot stall the Node event loop.

## Score

Recognition ranking is still
`(observed - expected) / sqrt(expected + 1)` with
`expected = T * p` from the English unigram list, unlisted `p = 0`,
and a fivefold multiplier for active-session terms
(`topics/pluggable-speech-recognition.md`). That formula is not a
simple excess count.

## What is approximate

- **Non-updated reordering.** Incrementing any token raises `T`, so
  every word’s score changes at a `p`- and `c`-dependent rate. Two
  untouched words can cross: the former 101st can become 100th when a
  low-ranked item is incremented. The live path only re-scores the
  incremented word against the current worst-of-top-k threshold. A full
  rebuild from the in-memory map runs on flush (1M new distinctive
  tokens or scan completion), not on every increment.
- **Bounded heaps, not the full lexicon.** A global distinctive heap
  keeps about 500 terms; each learned session keeps its own 100 with
  the session multiplier already applied. A recognition request merges
  those heaps by word and takes 100; the session entry replaces the
  global one rather than adding to it, so the multiplier is exactly
  fivefold and there is no global contribution left to subtract. Terms outside both heaps are omitted until
  a rebuild. Session state lives on the server (session key from the
  speech context); the client still *may* send `sessionTerms`, but that
  is not required for the overlay.
- **Tail-only fingerprints.** A blocked Bloom filter of content hashes
  skips already-seen messages. Revised or deleted text is not
  subtracted. Dropped tokens are accepted. Membership is approximate:
  an uncounted message reads as seen at well under a percent and is
  skipped.
- **Counts are an in-memory string→count map** backed by a local-disk
  SQLite table. `count > k` is a linear filter of the in-memory map.
  The map is small enough to hold; it is not an ordered on-disk index.
- **Durability.** Unflushed counts and fingerprints are lost on crash,
  as are flushed ones the background writer had not reached. Scan work
  yields every 16 messages so the process stays responsive.

## Session weighting is a scale, not a blend

An active-session term is scored by multiplying its global score, five by
default and now configurable. No fixed factor can be right: global
counts grow with history without bound while a session's stay small, so
for every factor there is a history long enough to swamp it. The
multiplier fails slowly and silently as a user's corpus grows.

Blending belongs in probability space — interpolate the session's own
rate with the global rate, so a term that is a large fraction of *this*
session ranks on that fraction rather than on a count it cannot win.
An alpha interpolation is the shape.

The reservation shipped instead: a configurable share of the selection
held for the active session, a floor rather than a ceiling, zero by
default. It does not decay with history because it does not compete on
score at all, and the maintainer judged it close enough in spirit. The
blend remains the principled version, and the two are compatible: a
blend would set the ordering, and a reservation would still guarantee
presence.

Exact per-increment maintenance of the true top 100 under a changing
`T`, and a fully crash-safe log, were deferred.

Cheap exact-enough follow-up: rebuild the global 500 from the map more
often (time or `T`-doubling), still without walking every session’s
transcript.

Found 2026-09-09 while replacing SQLite per-token updates that blocked
the server; the maintainer accepted clumsy ranking approximations and
asked that they be recorded.

# The vocabulary seen filter may not need to be durable at all

Compaction now bounds the filter in time: at a tenth of a percent false
positive it is rebuilt from the last epsilon of history and swapped in by
rename, with a floor recorded so the forgotten messages cannot count twice, and
every learned count survives. See
[pluggable speech recognition](../topics/pluggable-speech-recognition.md) for
the contract. What follows is what that left open.

**A correction to this entry's earlier framing.** It previously said nothing
detected saturation and nothing recovered from it. That was wrong, and it came
from a search for `saturated` that could not match `seenSaturated`.
`VocabularyLearning` has always read the getter and responded by emptying the
filter and everything counted through it. The real defect was that this full
clear was the *only* response, so the price of a filter that filled up was every
learned count outside the retained window. Compaction is the cheap answer that
now precedes it; the clear remains as the last resort.

## Is the durable filter earning its keep

With compaction in place the filter's durable state spans one epsilon. That is
close enough to nothing that the question is whether to keep a file at all,
and there are two ways to answer it.

**Compare against the prior art before extending this.** The issue-association
acquisition path answers the same question on the same catalog rows and answers
it better: a durable per-session resume cursor over source position, file
identity and a boundary hash, so appends resume and a detected rewrite resets
acquisition. It never re-reads what it consumed. Vocabulary learning re-reads a
changed session from the retrospective cutoff and discards what it recognizes.
If that cursor generalizes, the filter's remaining job disappears rather than
shrinks. This audit should happen before any further work here.

**Or drop the durable filter and accept sloppy counts.** Keep no file, resume
counting at a watermark, and accept that a restart may miss or double count.
Faster and markedly simpler, and it buys that with really sloppy counts, so it
needs a decision rather than a review. The write interval bounds the error at
its default of ten minutes. A watermark stronger than a file modification time
is already stored: counts and per-session checkpoints are written in the same
batch, so the `hasScanned` `{version, cutoff}` rows are already consistent.

## Resuming after a pause needs a live feed, not an anchor

**Superseded.** The section below proposed a stored "collect from this instant"
so that zero hours could mean live collection. That was making a replay window
impersonate arrival. The real answer is
[the missing live tail](vocabulary-learning-has-no-live-tail.md): a message that
arrives while collection is on qualifies without any timestamp test, replay
stays gated by the window, and nothing needs anchoring. Kept because the
measurement and the skip-or-cover reasoning still hold for the replay half.

## The anchor proposal, superseded

The maintainer proposes that resuming collection sets hours to zero, meaning
collect from now on rather than replay the gap. That cannot be expressed by the
hours setting as it is computed today, and the reason is worth recording before
anyone implements it: a scan derives its cutoff as `now - hours` at the moment
the scan runs, so zero hours yields a cutoff of *this instant*, every time. A
message written five seconds earlier is already below it. Zero hours would
collect nothing, ever, rather than everything from the resume onward.

"Collect starting now" is therefore an anchor — a stored instant — not a window
width. With one, the maintainer's block rule becomes expressible: a gap may be
skipped entirely or covered entirely, never half. Either the requested cutoff
reaches back past the pause, in which case the anchor is ignored and the whole
gap is collected, or the scan is held at the resume anchor and the gap stays
uncollected until a clear or a wide enough window unblocks it. Anything between
those would claim contiguous coverage it does not have.

That also separates two values the design has been conflating: how far counting
has contiguously reached, which freezes at a pause, and the floor below which
content is not counted, which compaction sets. They are independent, and a mode
that drops the fingerprint filter would still need the first.

## A continuously advancing watermark

The floor implemented today moves only when compaction runs. A watermark that
advanced continuously would keep the filter small at all times rather than
letting it grow to 137.6 million messages first, and it needs corroboration
rather than a plausibility check against the host clock:

- Advance only to a time several later observations agree has passed — a high
  quantile over a recent window, or the highest value some number of subsequent
  events exceeded. An outlier then cannot move it by construction, and nothing
  has to trust the local clock.
- Detect an implausible future timestamp and refuse to let it advance the
  watermark, rather than clamping it to the present plus a slack. Clamping
  writes down a synthesized time no content carries. The message is still
  counted; only its clock reading is distrusted.
- Accept the lag. A watermark that lags leaves more content inside the window,
  costing filter lookups that were not needed and losing nothing, while one that
  runs ahead skips content and undercounts silently.

Found 2026-09-10. Compaction landed the same day; the remaining questions are
whether the filter should exist and whether its floor should move continuously.

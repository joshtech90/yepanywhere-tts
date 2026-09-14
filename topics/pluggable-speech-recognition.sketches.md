# Speech vocabulary exploration candidates

> Candidate displays and recordkeeping beyond the learned unigram contract.

Topic: pluggable-speech-recognition

The shipped count comparison is specified in
[the speech topic](pluggable-speech-recognition.md#keyterm-biasing).
These candidates are not collection requirements.

## Prebuilt semantic coordinates without new collection

A lazily fetched, licensed map of common words can place existing learned
counts at fixed two-dimensional coordinates. Color and size can overlay
frequency excess and source mix. Such neighborhoods describe the reference
embedding's semantics, not relationships learned from this user's sessions.
Unknown words need a clearly separate tray; inventing nearby coordinates would
imply evidence that does not exist. Loading a prebuilt map on first display
requires no additional vocabulary recordkeeping. Select an actual immutable,
compact resource and verify its license, coverage, and coordinate semantics
before adding that view. Never fetch an embedding model during server startup.

## A map learned from the user's own corpus

Unigram totals cannot recover contextual relationships. This candidate changes
what is recorded and is explicitly deferred at the maintainer's request.

One option is sparse word cooccurrence counts within a defined durable message
or bounded token window. Another is word-to-occurrence references using stable
session and content fingerprints, allowing contextual embeddings to be computed
later from retained source text. Neither implies keeping a per-word list of all
fingerprints in the current unigram store. Cooccurrence windows must specify
order, distance, role separation, and how edits subtract old contributions;
UI order and transient turn IDs cannot define them. Retention, deletion, reset,
and storage budgets need a deliberate contract before collecting any of this.

For either prebuilt or corpus-derived embeddings, retain the embedding source,
model revision, tokenizer/normalization, vocabulary and count snapshot/reset
generation, and source-language coverage. A reproducible projection also pins
the projection method (for example UMAP), implementation version, seed,
distance metric, and parameters. Fit and normalization choices must be recorded.
Coordinate changes on incremental updates should be deliberate: anchor old
points or offer explicit recomputation, rather than moving the map on each
scan. Show projection distance as exploratory, not a measured semantic fact.

Zoom, pan, search, and count thresholds are display work that can be added
without changing the recorded corpus. A keyboard-accessible list with exact
counts should remain available alongside any spatial view.

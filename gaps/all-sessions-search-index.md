# All Sessions turn search still requires transcript sweeps

The initial All Sessions implementation pulls bounded native-record batches
from disk. It has no efficient disk-backed substring index for either explicit
selected sessions or the complete session catalog. Broader or unrelated needles
repeat acquisition. Appended characters refine retained whole text in uncapped
sessions; reaching 1024 matches or a text-byte cap stops that session and makes
the next needle rescan it. Batches rotate among eligible sessions; appends resume at
saved tails, and catalog changes no longer restart unchanged sessions.

Build the index behind the existing capability/coverage boundary in
[all-session content search](../topics/all-session-content-search.md). Evaluate
full substring candidates against token-begin-anchored search, including disk
amplification, short needles, Unicode boundaries, selected-session intersections,
append/rewrite invalidation and exact verification. A token-begin restriction
would be an explicit product contract, not a silent optimization. Worker or
off-node acquisition remains an option if measured disk/parse cost warrants it.

The first bounded native reader covers Claude and Codex families. Other
providers are marked title-only in the Providers menu and excluded from turn
acquisition; oversized/malformed records report partial coverage below results.
Extend their native bounded readers instead of falling back
to unbounded whole-session reads. Match ordinals currently count visible
records, not coalesced conversational turns; normalization parity across record
boundaries and Markdown display delimiters remains to be established.
Tail continuation detects inode replacement, truncation, layout changes and
saved-boundary changes. A rewrite of earlier bytes followed by growth that
preserves the saved boundary needs stronger native mutation evidence for exact
invalidation; the index must not treat boundary sampling as a full-prefix hash.

The index should return low-latency session-grouped matches with original
timestamps, stable IDs and on-demand context, while keeping coverage explicit.
Cap retained memory, share identical source-version work across clients, stop
unused work, and measure query/cancellation cost against the reference scan.
Diagnostic details need a separate retention/aggregation budget for heavily
corrupt transcripts; the current match and text-byte limits do not bound them.
Oversized native JSONL records are skipped before classification, so diagnostics
can incorrectly suggest lost searchable turn content for command-output records.
Bounded classification/extraction should distinguish these without unbounded
JSON parsing or silently hiding possible User/Ass. coverage loss.

The requested one-active-needle-per-viewer server guard is not implemented.
Current client generations share four request slots, and the server separately
caps batches; neither establishes viewer/revision ownership. The canonical
[stopgap contract](../topics/all-session-content-search.md#server-needle-ownership-requested-stopgap-not-yet-enforced)
allows an initial global last-writer-wins guard, requires stale-owner teardown,
and preserves parallel session fan-out. Implement behind a reviewed compatible
protocol before claiming that invariant; client cancellation alone is insufficient.
The [index sketches](../topics/all-session-content-search.sketches.md) preserve
candidate structures and measurement gates.

Found 2026-09-14 while implementing the approved All Sessions search design.

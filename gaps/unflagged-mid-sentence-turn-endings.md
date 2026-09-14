# A turn the service cuts mid-sentence is displayed as an ordinary ending

Claude sometimes ends a turn in the middle of a sentence while reporting a
normal end of turn. The transcript record carries `stop_reason: "end_turn"`
with a complete usage block, and its billed output tokens match the truncated
text at the same characters-per-token ratio as complete turns, so nothing was
lost between the service and disk. The transcript offers no field that
distinguishes this from a turn the agent chose to end, unlike the steering
abort beside it, which Claude Code stamps `isAbortedMidStream` and which the
transcript view now marks (`TextBlock` `abortedMidStream`, see
[steer/queue provider differences](../topics/steer-queue-provider-differences.md#a-steer-that-cuts-the-turn)).

Observed twice in one session on 2026-09-11 at 01:25:55Z and 01:29:09Z, Opus 5
at high effort with roughly 370k tokens of context. Two events in 382 completed
text turns across four days of session files.

Detecting it needs a text heuristic, and a measurement says a punctuation rule
is provider-specific rather than general. Over one user's full local corpus of
completed turn-final assistant texts:

| provider | turns | ends without `.!?` | prose-cut rule | prose-cut, turn ≥400 chars |
|---|---|---|---|---|
| claude | 1177 | 9.3% | 14 | 2 |
| codex | 10747 | 16.8% | 63 | 16 |
| pi | 264 | 39.0% | 25 | 2 |

The prose-cut rule ignores a final line that is a code fence, table row, list
item, or heading, ignores an unclosed fence, and fires when the text ends in a
letter or a comma. Adding the length gate leaves exactly the two real cuts for
Claude and no false positives in 1177 turns, but every one of Codex's 16
surviving hits is a legitimate ending: a status block closing on `GPU: L40S
idle`, or a sentence closing on a bare documentation URL. Pi's two survivors
are likewise fine. So the rule tracks one provider's prose habits, not a
general property of a finished turn, and shipping it across providers would
mislabel ordinary turns.

Not fixed in place because a rule that is accurate for one provider and wrong
for another needs a product decision about scope, and because the cheap
accurate alternative is a small "is this a valid turn ending" classifier rather
than punctuation. If a heuristic does ship, gate it per provider and keep the
length gate; the marker should read as a question about the ending rather than
an assertion that the service failed.

Reproduction data: any Claude session JSONL. Select assistant records with
`stop_reason: "end_turn"` whose last content block is text, then compare the
final character against the rule above.

Found 2026-09-11 while adding the steering-abort marker to the transcript view.
Contributing-model: opus-5

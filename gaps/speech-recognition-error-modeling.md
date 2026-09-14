# Speech keyterms lack a learned recognition-error model

The current selector uses learned usage, English rarity, and recent session
use as heuristics. It does not estimate which terms Grok actually misses,
including homophones, acoustic confusability, pronunciation, or speaker-specific
errors. English frequency is a proxy, not a measured error probability.

The intended objective is expected missed uses:
`P(term used next | current context) * P(recognizer misses term | spoken, context)`.
The first factor needs usage and session recency; the second needs recognizer
error evidence. Select the highest-value terms within each backend's limits
(Grok: 100 terms, 50 characters each). Numeric scores remain internal to YA.

Deferred at the maintainer's request while wiring vocabulary and recency into
Grok through YA. Owners include `packages/server/src/services/voice/`, speech
audio retention, and `packages/client/src/lib/speechDraftTransaction.ts`.
See [the speech contract](../topics/pluggable-speech-recognition.md#keyterm-biasing)
and [project-specific selection](project-specific-speech-vocabulary.md).

Investigate adaptive evidence from:

- Manual edits to a recognized span before or after submission, linked to its
  transcription and final submitted text.
- Corrections or clarifications in later messages after a recognition error
  was sent, including explicit "I said X, not Y" corrections.
- Repeated substitutions, homophones, spelling repairs, and their acoustic
  context when retained audio is available and permitted.

Do not label every edit as a recognition error: revisions, changed intent,
formatting, paraphrases, and assistant guesses need distinct treatment.
Track provenance/confidence, provider/model, and stable transcription/message
identity; deduplicate reentry and let deletion/reset remove learned evidence.
Specify opt-in collection, retention, bounded storage/memory, and compatibility
before adding records. Keep raw audio optional under existing retention policy.

Validate on held-out corrected examples and matched audio with/without keyterms,
checking both repaired misses and new false substitutions. An error predictor
alone is not evidence that biasing those terms improves recognition.

Found 2026-09-09 while refining speech vocabulary selection; the maintainer
explicitly requested adaptive error modeling as a deferred gap.

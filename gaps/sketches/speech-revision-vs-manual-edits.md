# Reconcile recognizer revisions with manual edits to dictated text

Streaming recognizers revise text YA has already committed to the draft. xAI
streams `is_final` chunks, then sends a whole-utterance `speech_final` whose
text is a fresh, often better decode of the same audio: punctuation, word
joins and hyphenation change. YA applies the revision by replacing the
speech-owned characters immediately before the speech range
(`replacePreviousTranscriptChars`). That is correct only while the owned span
contains exactly what the recognizer emitted.

Two user behaviours break that assumption:

- **Typing during a pause.** The user inserts words between dictated chunks
  while capture continues. The revision covers the audio on both sides of the
  typed words but not the words themselves, so a character-count replacement
  can overwrite them or leave fragments.
- **Correcting a streamed chunk before its revision lands.** The user fixes a
  misrecognised word, then the revision replaces the span. Either the fix is
  lost, or the replacement is misaligned because the span's length changed.

The likely shape is a three-way merge: base = the text as streamed, ours = the
draft span as edited, theirs = the revision. Keep edits that the revision
neither overlaps nor already makes (the user's intentional additions). When
the user's change and the revision differ in the same place, prefer the user's
change, since it is a deliberate correction. Edit similarity, at word level
and preferably aligned by the recognizer's word timestamps, has to tell
genuine user additions apart from the recognizer's own reformatting. Until
then, a cheap safe step is to skip the revision for a span the user has edited
and keep the streamed text plus the edits.

Neither scenario has been reproduced; YA's behaviour today in each is
unverified. The existing auto-send hold after a manual edit
(`composerEditedDuringSpeech`) already detects the edit and could gate the
skip-revision step.

Raised 2026-10-18 while fixing duplicated follow-up dictation under Grok
streaming.
Contributing-model: opus-5-5

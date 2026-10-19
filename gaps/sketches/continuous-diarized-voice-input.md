# Continuous voice input that listens only to the user

Requested: a quiet-room mode where YA listens continuously, turns graehl's
speech into session messages without a tap per turn, and ignores other
voices in the room, such as children. Smart Turn partly supports this
today; this sketch is the full version.

## What exists

- Smart Turn endpointing on streaming backends (xAI) can auto-send a turn,
  with spoken `send` / `cancel` / `wait` control words
  ([mic button speech UI](../../topics/mic-button-speech-ui.md)).
- **Follow-up listening** (default off) reopens a speech transaction after a
  speech-triggered send, but only for a bounded window; Keep Mic Warm keeps
  the device open without listening.
- Nothing attributes speech to a speaker. Any voice the microphone hears
  becomes draft text.

## What is wanted

1. **Continuous listening session.** An explicit, visibly indicated mode
   that keeps recognizing across turns until turned off, rather than a
   follow-up window that expires. Endpointing still decides when a turn is
   sent.
2. **Speaker attribution with a preferred speaker.** Enroll the user's
   voice once; label each recognized segment by speaker; send only the
   user's segments, and drop or visibly set aside others' speech. A
   segment that cannot be attributed confidently is held as a draft, not
   sent.
3. **Transcript where the user is looking.** For the motivating use, the
   recognized text should be readable on the screen the user is working
   on (a game), not only in the YA composer beside it: at least a
   compact always-visible transcript view, perhaps a detachable window.

## Open design questions

- Whether a cloud streaming backend in use (xAI) offers per-speaker labels
  or speaker verification; not checked. If not, attribution needs a local
  diarization or speaker-verification model as a pluggable speech backend
  ([pluggable speech recognition](../../topics/pluggable-speech-recognition.md)),
  which stays within YA's role as long as the model runs as a separate
  backend service rather than inside YA.
- Enrollment storage and its scope (per user, per device), and how a
  limited user's sessions are affected.
- Privacy defaults for an always-open microphone in a shared home: opt-in
  per session, a persistent listening indicator, no audio retention unless
  separately enabled.
- Interaction with the existing control words and the command grace
  window during long continuous sessions.

## Motivation

graehl solves puzzles better when he types his beliefs to an agent
partner, and wants to compare speaking them aloud, with and without
looking at the transcript. That self-experiment is proposed in
`~/agents/research/verbalizing-while-solving/proposal.md`; its spoken
conditions need this mode.

Requested 2026-10-17 during an Order of the Sinking Star puzzle session.
Contributing-model: claude-opus-5-5

# Learned speech vocabulary is global, without project-specific selection

Speech recognition selects terms from installation-wide user and assistant
counts, with a bonus for the currently loaded session's terms. It cannot favor
names from other sessions in the same project or keep another project's
specialized vocabulary from occupying the limited keyterm budget.

The owners are `packages/server/src/services/voice/VocabularyStore.ts`,
`VocabularyKeyterms.ts`, and the speech request context in
`packages/server/src/routes/speech.ts`. The existing contract and context
candidates live in [the speech topic](../topics/pluggable-speech-recognition.md#keyterm-biasing).

A first version needs no new source of text. The sessions already scanned belong
to projects, so their existing counts can carry the mixture, reservation or
upweighting below on their own; reading a project's documents is a later
addition, not a prerequisite. What keeps even that first version deferred is
that it still opens two paths this feature does not have: a vocabulary
visualizer that can show the effective selection for a chosen project rather
than only the global default, and eventually the document scan. Recorded
2026-09-09 at the maintainer's direction.

Deferred at the maintainer's request while implementing global
excess-over-English ranking. Project-aware selection needs a deliberate
collection and request-context contract, beyond changing the ranking:

- Associate durable session contributions with canonical YA project identity;
  preserve stable rescan, replacement, reset, and deletion semantics.
- Build on the active-session hints already supplied to batch and streaming
  requests, including a policy for drafts without a session. Define global fallback and
  default-off project biasing without depending on an unsupported server route.
- Consider project glossary terms and file names separately from learned
  occurrence counts; do not invent observed counts for these sources.
- Read the project's own written vocabulary, not only its transcripts: a
  `GLOSSARY.md` chain, `topics/` and `docs/` prose, and README head matter name
  the terms a speaker uses before any session records them. A glossary row is a
  deliberate naming decision, so it deserves standing above an incidental
  mention, and it supplies the spelling and case directly instead of inferring
  them. Decide read scope, size bounds, refresh triggers, and how a documented
  term ranks against a spoken one, and keep every read inside the app data
  directory. Requested by the maintainer 2026-09-09 while adding case
  projection, which fixes spelling for words already spoken but cannot
  introduce a term the transcripts have never carried.
- Keep a small project's terms from drowning in the global corpus. Counting
  everything in one pool makes selection a function of running-text volume, so a
  project spoken about once loses to projects carrying ten thousand times the
  text, which is exactly backwards for the project the speaker is in. Two shapes
  are worth comparing: reserve a share of the hundred slots for project terms,
  the way capitalized common words already hold a fifth; or score project and
  global evidence separately, each against its own corpus size, and interpolate
  the two with a stated weight. Prefer whichever keeps a one-session project's
  own names present without letting a thin corpus manufacture confident terms.
- Give exploration a scope control: the effective vocabulary for a named
  project, or the global default it falls back to. Without it a project-weighted
  selection is invisible, and the current view would keep showing installation
  totals that no longer describe what a recognizer receives.
- Bound per-request queries and retained caches. Keep YA indexes in app data;
  project browsing must not write into the selected project.
- Test identical audio requests in two projects selecting different relevant
  terms, plus missing-context fallback and isolation after reset/reentry.

Found 2026-09-09 while refining learned vocabulary for Grok through YA;
explicitly requested as a follow-up gap by the maintainer.

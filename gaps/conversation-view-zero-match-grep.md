# Zero-match Grep rows surface in Conversation view

A Grep (or equivalent search) that finds no matches still appears as a
top-level Conversation view row, including a green success glyph and
sometimes an "image unavailable" thumbnail. Zero matches are ordinary
search outcomes, not conversation and not a failure the supervisor needs
at the condensed layer. They should fold into the per-turn activity
summary like other routine complete tools.

Checked 2026-09-14: the proposed exit-code cause does not describe the current
Codex normalizer. `packages/server/src/codex/normalization.ts` already
treats recognized Grep exit 1 with zero files as success; its normalization
tests cover that outcome. The Conversation classifier already folds complete
ordinary tools into activity unless they carry media, commentary, or workflow
output. Empty normalized search output does not supply image data.

The observed row and unavailable thumbnail therefore still need a concrete
affected session or captured tool event. Trace its normalized result and media
classification before changing either owner. Preserve real search failures
(bad regex, missing path, exit 2) as errors, and do not hide legitimate media or
commentary with a blanket Grep exception.

Found 2026-09-09 while adding turn-rail **Handoff from…**.

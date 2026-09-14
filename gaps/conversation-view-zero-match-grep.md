# Zero-match Grep rows surface in Conversation view

A Grep (or equivalent search) that finds no matches still appears as a
top-level Conversation view row, including a green success glyph and
sometimes an "image unavailable" thumbnail. Zero matches are ordinary
search outcomes, not conversation and not a failure the supervisor needs
at the condensed layer. They should fold into the per-turn activity
summary like other routine complete tools.

Likely cause: ripgrep/Grep exit code 1 (no matches) is treated as
`status: "error"`, so `conversationViewSurfaceReason` returns `error`
and Conversation view retains the row.

Cheap fix: classify no-match Grep/search completions as `activity`
(and keep real grep failures — bad regex, missing path, exit 2 — as
`error`). Do not promote them to a red error row as the way to hide
them.

Found 2026-09-09 while adding turn-rail **Handoff from…**.

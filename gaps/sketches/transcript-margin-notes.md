# Transcript margins cannot host contextual notes

The maintainer requests margin notes alongside the transcript when a wide
window leaves space outside the preferred content width. Keep the narrow text
column: the intent is to use spare margins for useful contextual material,
not to widen prose to fill the screen. On phones or other narrow windows,
the same notes belong above or below their associated content.

This is a requested presentation opportunity, not a claim that the existing
content-width default is defective. The wide-screen composer capture and
async-question discussion exposed the opportunity; specific note types and
their producers have not been selected.

## Desired behavior

- Associate each note with a specific transcript passage or item so its
  context remains clear. Wide layouts may place it beside that content.
- Use margins only when sufficient usable space remains after the chosen
  content width and other visible UI. Base placement on actual available
  space and text sizing, not a phone/desktop label.
- When the margins cannot fit the note, place it above or below its source
  content, preserving association, reading order, and access to actions.
  A narrow window must not lose notes or require horizontal scrolling.
- Handle adjacent notes without overlap, and preserve reading position,
  drafts, and focus when resizing or switching between margin and inline
  placement. Streaming must not displace a reader in scrollback.

Relevant owners for investigation are the transcript layout in
`packages/client/src/components/MessageList.tsx` and the session layout in
`packages/client/src/pages/SessionPage.tsx`. Follow
[responsive layout](../../topics/responsive-layout-gaps.md) for sizing and
[scrollback stability](../../topics/scrollback-view-stability.md) for anchoring.
No dedicated margin-note entry was found in gaps, topics, tasks, or tacticals.

Before implementation, choose above/below placement, collision behavior, and
how users enable the feature under
[vanilla defaults](../../topics/vanilla-defaults.md). Verify wide and narrow
windows, large text, dense adjacent notes, resize, and streaming. This gap
does not change the chosen in-transcript answer composer in the
[async-question gap](../codex-async-question-answer-ui.md).

**First note type chosen (2026-09-15):** human-authored comments on
transcript passages that are not delivered to the provider, for text
intended for human readers. They are the margin-notes half of the
[participatory live share sketch](../../topics/relay-origin-and-share-gating.sketches.md#margin-notes-comments-for-human-readers),
and the same UI appears in a single-participant session. A note reaches the
agent only through a manual copy, paste, or quote-reply into a composer.
Each note carries its author's seat ([named participant seats](named-participant-seats.md)).
Notes are visible inline without expansion; the first presentation to try is
an inline pill reflowing with the passage, with a wider-margin versus
collapse toggle as the only presentation control. Notes double as a
long-session navigation aid: a drawer of all notes, a notes scope for the
existing Ctrl+S / Ctrl+R message-list isearch with rail notches previewing
matching notes, and a visible toggle for pointer and touch users; see the
share sketch's navigation bullet and
[isearch has no touch entry](../isearch-has-no-touch-entry.md).

The remaining interaction decision is the click target: whether a plain
click on non-link passage text opens a note, a deconflicting modifier or
long-press is required, or the note action rides the existing per-block
quote circle and selected-text context menu from
[selection comment UI](../../topics/selection-comment-ui.md). The share
sketch lists the trade-offs; decide with captures before building.

Not implemented: no concrete interaction has been chosen yet.

Found 2026-09-07 while discussing async-question navigation and the spare
margins around a width-limited transcript/composer on a large screen.
Contributing-model: 6-Astra.

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
[responsive layout](../topics/responsive-layout-gaps.md) for sizing and
[scrollback stability](../topics/scrollback-view-stability.md) for anchoring.
No dedicated margin-note entry was found in gaps, topics, tasks, or tacticals.

Before implementation, choose the first useful note type, above/below
placement, collision behavior, and how users enable the feature under
[vanilla defaults](../topics/vanilla-defaults.md). Verify wide and narrow
windows, large text, dense adjacent notes, resize, and streaming. This gap
does not change the chosen in-transcript answer composer in the
[async-question gap](codex-async-question-answer-ui.md).

Not implemented: the request was to capture a separate YA gap; no note type
or concrete interaction has yet been chosen.

Found 2026-09-07 while discussing async-question navigation and the spare
margins around a width-limited transcript/composer on a large screen.
Contributing-model: 6-Astra.

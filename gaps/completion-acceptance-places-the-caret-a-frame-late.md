# Accepting a composer completion places the caret a frame late

`handleSlashCommandCompletion` and `handleSlashArgumentCompletion`
(`packages/client/src/components/MessageInput.tsx:2291`, `:2323`) set the
draft text and then, in a `requestAnimationFrame`, focus the textarea and
`setSelectionRange(nextCursor, nextCursor)`.

This is not the dropped-keystroke defect that
[early-typing-handoff](../topics/early-typing-handoff.md) fixed elsewhere —
the textarea is already focused, so a key struck in that frame does reach it.
The exposure is ordering: that key is inserted wherever the caret happens to
be, and the frame then moves the caret to a `nextCursor` computed before the
key existed. A fast keystroke right after accepting a completion can therefore
land in the wrong place and leave the caret somewhere else again.

Probably fixable the same way as the rest: place the caret in the commit that
renders the new text (a layout effect keyed on the pending selection, which
this file already has as `pendingTextareaSelectionRef` in `NewSessionForm`),
rather than a frame later. Confirm first whether the frame is load-bearing for
the completion menu's own teardown.

Not fixed in place: the adjacent work was the navigation-to-a-typing-target
sweep, and this path is neither a navigation nor a focus transfer, so it wants
its own reading of the completion flow.

Found 2026-09-19 while implementing early typing handoff across the
navigations that land on a typing target.

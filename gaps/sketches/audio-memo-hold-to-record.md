# Hold-to-record audio memos on mobile

Deferred alternative to the approved unified tap-based memo flow: hold to
record while the pointer remains pressed, slide away to cancel, and release
to stop and send. The initial flow uses a tap to start, an explicit recording
surface that stops and sends when tapped, and separate Restart / Cancel.

Decide the gesture's owner before implementing it. Attachment long-press
already opens the shared attachment context menu in the approved design;
hold-to-record must not silently steal that gesture. Consider the mic or an
explicit hold-to-record preference, with discoverable cancellation feedback.
Verify pointer cancellation, scrolling, permission prompts, loss of focus,
multi-touch and accidental release on real phones. No implementation yet.

Requested 2026-10-01 during audio memo interaction design.
Contributing-model: 6-astra

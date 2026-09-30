# Keyboard-aware app size and composer-adjacent session content

User-directed, 2026-09-28: embedded canvas apps should know when their usable
height temporarily shrinks, and the session should retain the current content
adjacent to the composer above the software keyboard. This is an enhancement
and coverage gap; no current-device failure has been reproduced in this task.
It accompanies [project service](../../topics/project-service.md) and the
existing [mobile viewport contract](../../topics/ui-architecture.md#mobile-viewport-ownership).

## Existing behavior to preserve and verify

`NavigationLayout.tsx` computes a focused-text-entry bottom inset from the
top-level `visualViewport` height and offset, listens to resize/scroll and
focus changes, and avoids double-insetting an already resized layout viewport.
Its `getVisualViewportBottomInset` now includes wide layouts and iframe focus,
and ignores pinch-zoom geometry. NavigationLayout tests cover mobile/tablet
inset, offset, restoration, zoom and double-inset cases. These are synthetic
geometry checks, not proof of native tablet keyboard behavior.

`MessageInput.tsx` also resizes its textarea on window/visual-viewport changes.
Verify transcript anchoring alongside this; keeping the textarea visible alone
does not establish that the same composer-adjacent conversation content remains
visible. No project-app keyboard-geometry bridge was found in the scoped source
search. Inspect existing scroll ownership before adding another observer.

## Candidate mechanism

- Prefer resizing the actual iframe/container to its usable rectangle. Inside
  the app, `ResizeObserver` on its canvas container supplies the new size;
  redraw the canvas at the appropriate device-pixel ratio, retaining application
  state and pointer-coordinate mapping. Do not rebuild/reload the app or reset
  its scene just because the keyboard appeared.
- When a keyboard overlays rather than resizes, YA measures visible geometry
  at the top-level window using `visualViewport` and, when available,
  `VirtualKeyboard` geometry. A child's own visual viewport does not reveal
  top-level occlusion. Intersect the reported region with each pane; do not
  subtract a keyboard height twice or assume a full-width keyboard.
- If preserving the iframe's layout size is preferable, expose a versioned,
  opt-in message carrying only the app-local usable/occluded rectangle.
  Validate it against the existing viewer's child window and grant lifetime;
  disclose no parent DOM, credentials or unrelated pane information. An
  ordinary app without the protocol still gets sensible container resizing.
  Reuse the existing viewer communication owner rather than opening another
  unrestricted `postMessage` channel.
- Feature-detect browser support. Zoom, browser bars and keyboard motion are
  different causes of viewport changes. A floating keyboard may report only
  partial geometry, or no useful geometry; document those limits instead of
  claiming YA can confine or position the platform keyboard.

The platform building blocks are
[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver),
[VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)
(only the top-level window exposes the distinct visual viewport), and the
limited-availability
[VirtualKeyboard API](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API).
The implementation resizes the actual iframe; no message bridge or
VirtualKeyboard API is needed for browsers reporting usable visual-viewport
height. Floating occlusion not reported there remains a platform limitation.

## Session anchoring requirement

During keyboard open/close, rotation and composer growth, keep the currently
composer-adjacent transcript content in view above the composer. If following
the live tail, retain bottom pinning. If the user has scrolled up, retain the
current content anchor and relative position rather than jumping to newest
output. Coordinate the adjustment with streaming appends and draft edits;
do not scroll the outer document or apply competing inset/scroll corrections.
Restore the larger viewport without a jump when the keyboard closes.
Use the existing [scrollback stability owner](../../topics/scrollback-view-stability.md)
for these two scroll regimes. The separate
[persistent session-pane offset report](../session-pane-persistent-offset.md)
has no established keyboard cause; do not conflate the two without evidence.

## Acceptance

Exercise iPad Safari and Android Chromium tablets with app/session side by
side, plus small-phone single-surface navigation. Cover docked and floating
keyboards, text input in the composer and in the isolated app, keyboard
open/close, rotation, browser chrome changes, zoom and streaming output.
Verify reported app dimensions against the visible bounds, persistent canvas
state and accurate pointer mapping. Check both tail-following and scrolled-up
transcript anchors, caret visibility, sequential typing and no double inset.
Synthetic geometry tests are useful but must be distinguished from native
keyboard/device evidence. No platform keyboard was exercised in this task.

Implemented 2026-09-28: the shared viewport owner resizes desktop/tablet and
phone surfaces while retaining the app. Real browser checks simulate a 200px
height reduction and verify iframe shrink without canvas reset; phone switching
retains the canvas and sequentially typed draft. Existing MessageList resize
checks pass for tail pinning and scrolled-back position preservation. The
native-device matrix above remains open; do not describe simulation as native
keyboard evidence. Contributing-model: 6-Astra.

Found 2026-09-28 while revising the project App viewer and discussing tablet
keyboard occlusion. Contributing-model: 6-Astra.

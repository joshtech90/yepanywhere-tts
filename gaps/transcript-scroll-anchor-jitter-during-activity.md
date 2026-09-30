# Transcript scroll position jitters by a few pixels during live activity

With follow off (scrolled up, or paused under a held mouse button), live
activity still moves the transcript scroller: the browser's own scroll
anchoring adjusts `scrollTop` when rows above the viewport change height, then
`restoreScrollToAnchorRow` (`packages/client/src/lib/scrollAnchors.ts`, called
from `useTranscriptRenderWindow.ts`) and the `MessageList` ResizeObserver
correction write it back. A probe of a live Claude turn on 2026-09-29 recorded
5–30 px excursions corrected within a frame or two, and occasional
oscillation between the two adjusters (e.g. 33169 → 33174 → 33169).

The selection fix no longer depends on this (the drag keeps its press point
regardless), but text visibly nudging under a held button is still the
"flicker" the maintainer asked to be absent. Cheap direction: give the
transcript scroller `overflow-anchor: none` so the app's anchor restore is the
only adjuster, then confirm `scrollTop` stays fixed while rows above change.
Evidence method: wrap the `Element.prototype.scrollTop` setter and log scroll
events with stacks while the mouse button is held over a live turn.

Found 2026-09-29 while fixing drag selections lost during live activity.

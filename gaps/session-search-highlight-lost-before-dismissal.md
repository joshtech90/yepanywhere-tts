# Session search sometimes loses its initial match frame

During the CI isolation campaign on 2026-09-30, the unchanged Escape
stability case failed before dismissal because `[data-search-match="true"]`
never appeared after clicking the preview. A four-worker, no-retry batch had
one such failure among 20 attempts, alongside two separate 60px dismissal
drifts. An instrumented 40-attempt batch also reproduced the missing frame.
The failed case is `session-isearch-scope-controls.spec.ts:125` at its initial
frame assertion, not the final geometry assertion.

The [dismissal drift](search-dismiss-escape-moves-landed-match.md) has a captured
ResizeObserver writer and a supported stop-follow repair. That repair does
not explain a frame missing before Escape. Keep the initial frame assertion;
do not introduce a pre-click sleep or weaken the final two-pixel bound.
A later 40-attempt unmodified batch passed, so isolated success does not close
this separate finding. Next capture the row's identity, connection and highlight
attribute transitions around preview selection to distinguish a detached-row
highlight from a superseded reveal or an unexpected clear.

The campaign independently reproduced a supported highlight ownership defect:
replace the mounted row with another element carrying the same render ID after
arrival, and the frame remains on the detached element. The controlled hook
regression fails before repair. The hook now transfers the frame to the connected
row with that identity without scrolling again, renewing its lifetime, or
allowing a cleared generation to repaint. Tests also cover the original fade
deadline and a clear while the remount callback is queued. This does not prove
which path caused the historical missing initial frame; retain this gap pending
repeated browser and exact-SHA CI evidence.

The final read-only review identified four unproved candidates: a preview
whose anchor is absent during synchronous preparation, cancelled history
hydration, both reveal passes reporting no resolvable row, or a clear voiding
the reveal generation. The loaded specimen makes history hydration less
likely. A next diagnostic should record selection/preparation, reveal result,
paint/transfer identity, and the literal clear reason using bounded native
performance marks, then collect only that sequence on assertion failure.
The heavier temporary observer diagnostic passed 160 attempts and was removed;
it did not establish the historical cause. Do not change preparation or reveal
behavior without a captured writer or a supported deterministic regression.

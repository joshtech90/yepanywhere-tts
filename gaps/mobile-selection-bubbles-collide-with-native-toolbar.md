# Floating selection bubbles collide with the phone's native selection toolbar

On a coarse primary pointer, the selection action cluster docks above the
composer only when the selection lies in the transcript root
(`packages/client/src/hooks/useSelectionActionCapture.ts`, `docked: mobile &&
selectionRoot === root`). Every other registered selection root — session file
viewers, rendered previews, nested viewers — gets the desktop floating
placement, which picks the first clear side among after/before/below/above the
selected text. On phones that is where the OS draws its own Copy / Select all
toolbar, so two similar rows of actions compete for the same spot (maintainer
report 2026-09-29, "mobile-default").

Cheap direction: on a coarse pointer, dock the cluster for every root (or,
where docking has no host, keep the float out of the band the native toolbar
occupies above and below the selection). Needs on-device verification on
Android Chrome and iOS Safari, where the native toolbar's position differs;
headless captures cannot show it. Contract owner:
`topics/selection-comment-ui.md` § What the user sees, item 2.

Found 2026-09-29 while fixing drag selections lost during live activity.

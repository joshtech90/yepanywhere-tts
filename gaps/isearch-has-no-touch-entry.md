# Share-viewer isearch starts only from the keyboard

The in-session incremental search (`useMessageListIsearch`, wired in
`MessageList.tsx`) starts from Ctrl+R, Ctrl+S, Ctrl+Alt+S or Ctrl+Alt+K, or
from the session composer toolbar's Search transcript button (2026-09-23).
The public share viewer (`PublicSharePage`) mounts the same message list but
no composer toolbar, so a phone or tablet reader of a shared session still
cannot open transcript search, even though the search panel, its scope
picker, arrow navigation and rail match previews all work by touch once
open.

The fix is one visible viewer control that calls
`requestSessionIsearchOpen()` from the tap, as the toolbar button does, so
the search input takes focus inside the gesture.

This blocks the touch half of the margin-notes navigation aid in the
[participatory live share sketch](../topics/relay-origin-and-share-gating.sketches.md#margin-notes-comments-for-human-readers),
which reuses this search with a notes scope and whose readers are share
viewers.

Found 2026-09-15 while asking how a phone would activate Ctrl+S / Ctrl+R
search for margin notes; narrowed to the share viewer 2026-09-23 when the
composer toolbar entry landed.
Contributing-model: fable-5.1
Contributing-model: opus-5.5

# Message-list isearch starts only from the keyboard

The in-session incremental search (`useMessageListIsearch`, wired in
`MessageList.tsx`) starts when a keydown matches
`getSessionIsearchShortcutScope`: Ctrl+S, Ctrl+R, or Ctrl+Alt+S select the
user, all, or full scope. Inspection on 2026-09-15 found no other caller of
`startSearch`: no toolbar action, overflow-menu row, rail gesture, or
share-viewer control starts it. The composer toolbar's shortcuts card shows
the isearch key guide only once search is already active. A phone or tablet
user, or a mouse user who does not know the keys, therefore cannot open
transcript search at all, even though the search panel, arrow navigation,
and rail match previews all work by touch once open.

The cheap fix is one visible entry: a "Search transcript" action in the
composer toolbar's existing measured overflow allocator (never displacing
Send or Mic), opening the search in the user scope with the on-screen
keyboard focused in the search input, plus the same row in the share viewer.
Scope switching then needs a touch control inside the search panel, since
the Ctrl combinations that switch scope today are equally unreachable.

This blocks the touch half of the margin-notes navigation aid in the
[participatory live share sketch](../topics/relay-origin-and-share-gating.sketches.md#margin-notes-comments-for-human-readers),
which reuses this search with a notes scope.

Found 2026-09-15 while asking how a phone would activate Ctrl+S / Ctrl+R
search for margin notes.
Contributing-model: fable-5.1

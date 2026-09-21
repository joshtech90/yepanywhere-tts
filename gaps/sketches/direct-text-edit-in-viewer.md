# Edit viewed text directly instead of only commenting to the agent

A viewed `.md` or text file — in the session file viewer, the parked viewer,
or a Source Control dirty file — can only be read or annotated with a comment
that asks an agent to change it (`topics/source-review-to-session.md`,
`topics/selection-comment-ui.md`). For a typo, a sentence, or a line of prose
the user wants to type the change themselves. There is no file-write route in
`packages/server/src/routes/` today; every mutation goes through a provider.

Primary intent is editing **text**, not formatting. Acceptable shapes, in
order of ambition; each is a valid stopping point:

1. **Modal raw editor, v0.** An Edit action on the viewer opens a plain
   textarea of the whole file, scrolled and caret-placed at the region the
   user was reading (the viewer already carries a path-and-line controller,
   `topics/parked-file-viewer.md`). Close saves; Cancel discards. Needs one
   authenticated write route with a same-content precondition (the file's
   observed hash or mtime) so a concurrent agent edit is detected and
   reported rather than clobbered, and the same project-storage posture as
   any project write.
2. **Region editing in the rendered view.** Selecting or placing the caret in
   a rendered block swaps that block for its markdown source in an inline
   textarea; leaving it writes the block back. The source-positioned
   projection in `topics/aligned-markdown-diffs.md` already maps rendered
   blocks to source spans, which is the alignment this needs; the first
   implementation uses top-level block granularity, and a selection that
   spans blocks or a formatting boundary widens to the enclosing blocks.
3. **Full WYSIWYG markdown editing.** Type into the rendered view, with
   edits mapped back through the alignment to source text. Existing
   libraries do this (Milkdown, Tiptap with a markdown serializer, ProseMirror
   markdown); the choice is between adopting one against the runtime-dependency
   bar in `DEVELOPMENT.md` and extending the aligned renderer with a
   contenteditable overlay. The gating step is choosing or building a
   reasonably performing implementation; measure typing latency under the
   keystroke rule in `AGENTS.md` before committing to one.

**Session notice.** When the edited path has a last-editor attribution
(`GitFileChange.lastEditor`, `DirtyFileEditorService`; contract in
`topics/source-control.md` § dirty-file session action), offer to tell that
session: an optional notice, or a quoted before/after of the edited region,
delivered as a user turn. Show the session's liveness beside the offer (in
turn, idle for minutes, last active two days ago) so the user can choose
between notifying it and starting a fresh session, since a long-idle session
will miss its prompt cache and a new session may be cheaper. Default is no
notice; a notice is never auto-sent.

Constraints: the write must be an explicit user action, must never run while
the viewed file is mid-edit by a live session's tool call if that can be
detected, and must not touch formatting the user did not edit (no
re-serialization of untouched blocks in shapes 2 and 3). Binary and very
large files are out of scope.

Found 2026-09-19 while discussing project templates and limited users.

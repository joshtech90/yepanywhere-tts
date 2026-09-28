# Edit viewed text directly instead of only commenting to the agent

Related: [source-map aware artifact editing](source-mapped-artifact-editing.md)
extends this editor direction to generated HTML, character-level click
positioning, a full-workspace editing view, and optional registered regeneration.

The initial raw source editor is implemented in authenticated ordinary file
viewers; see [file source editing](../../topics/file-source-editing.md). It uses
explicit Save and a dirty-close choice instead of implicit saving on Close.
It opens at a supplied file/line location; tracking an arbitrary reading caret,
direct diff-pane entry, rendered-region editing, WYSIWYG, and the optional
last-editor session notice below remain future work.

Primary intent is editing **text**, not formatting. Acceptable shapes, in
order of ambition; each is a valid stopping point:

1. **Modal raw editor, v0 — implemented.** Edit opens a plain textarea,
   positioned at the supplied file/line location. Explicit Save uses an
   authenticated conditional write, and dirty Close offers Save or Discard.
   Following an arbitrary reading caret remains a refinement of the existing
   [path-and-line controller](../../topics/parked-file-viewer.md).
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

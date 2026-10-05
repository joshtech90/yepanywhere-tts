# `/v` view command — sketches

Candidate designs that extend the [view command](view-command.md) contract.
Not current guidance; routine topic reads exclude this file.

## Custom completion surface

Status: **built 2026-09-30**, except the open questions below. The finder
sheet, match highlighting, preview, tier headings, per-row jump to the
mentioning turn, explicit ignored-file search, Right-arrow narrowing,
Ctrl+Enter open, and the sheet shared with `@` completion are now contract in
[view command § Composer behavior](view-command.md#composer-behavior).

Built differently from the first sketch, for reasons that stay relevant:

- **Mentioned files are a tag, not a group.** A "mentioned in this session"
  section ahead of tracked files would rank a mentioned untracked file above
  every tracked one, against the tracked-first default the command was
  specified with, and would make the first row differ from what Enter on a
  closed menu opens. Mention stays a within-tier ranking signal; the row
  shows a `mentioned` tag and a jump control.
- **The explicit ignored search is added, not substituted.** Enter on an
  empty result still runs the ignored scan, as approved for the first
  version; the **Search ignored files** row makes that cost visible and
  optional from the sheet.
- **The phone preview sits under the list,** not as an expansion inside the
  highlighted row: a preview inside the listbox would put non-option content
  among its options.

### Open questions

- A shortcut that opens the sheet with an empty `/v` draft (Ctrl+P conflicts
  with browser print; Ctrl+Shift+O and a toolbar entry are candidates). A
  toolbar entry would be default-visible chrome and needs its own
  vanilla-defaults decision.
- Whether a per-project most-recently-opened list (not just transcript
  mentions) should rank first. It needs browser storage keyed by server and
  project, like `@` completion's enablement flag, and a bound.
- Whether the New Session composer should open files through a modal viewer
  or navigate to the standalone file page, since it has no session viewer.
- Opening several files in turn (Ctrl+Enter) replaces the one managed viewer
  each time; tabs belong to the [parked file viewer](parked-file-viewer.sketches.md)
  side-by-side sketch.

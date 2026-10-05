# `/v` view command

> `/v parts…` (also `/view`) in the session composer opens a file in the file
> viewer from a few remembered parts of its path, tracked files first, without
> sending anything to the agent.

Topic: view-command

Status: **implemented (2026-09-30).** Server: `searchFileView`
(`packages/server/src/services/projectFileViewSearch.ts`) over the
completion inventory in `projectFileCompletion.ts`; route
`GET /api/projects/:projectId/file-view-search`. Client: `useFileViewCompletion`,
`lib/fileViewCommand.ts`, `SessionPage` `handleFileViewCommand`, opening
through `presentProjectFileViewer` in `FilePathLink.tsx`. Parser:
`packages/shared/src/file-view-command.ts`. The finder sheet (match
highlighting, preview, tier groups, explicit ignored search) landed later on
2026-09-30: `FileViewCompletionSheet`, `useFileViewPreview`, and the shared
`ProjectFileCompletionMenu`. Remaining candidate designs are in
[view-command sketches](view-command.sketches.md).

See also: [project-path-links](project-path-links.md) (the link-click viewer
path this reproduces, and the `@` completion inventory this reuses),
[emulated-slash-commands](emulated-slash-commands.md) (YA-routed command
precedence), [parked-file-viewer](parked-file-viewer.md),
[vanilla-defaults](vanilla-defaults.md#known-exceptions).

## Motivation

An agent names a file without a usable form — a bare basename, a path
relative to some subdirectory, an absolute path from another checkout — or the
user half-remembers "that file". Asking the agent to find or link it costs a
turn and perturbs the session. `/v` resolves it locally and opens the same
viewer a file link opens.

## Syntax

- `/v` and `/view` are the same command, matched case-insensitively. The
  argument is one or more whitespace-separated **parts**. A double-quoted part
  may contain whitespace, `\"`, and `\\`; quoted and bare segments join until
  whitespace, as in a shell.
- The last part may end with a line target in the forms agents cite:
  `:42`, `:42:7` (column ignored), `:42-60`, `#L42`, `#L42-L60`. It becomes
  the viewer's line or range and is never a search needle.
- Matching is case-insensitive unless any part contains an uppercase letter,
  then case-sensitive (smart case).

## Resolution

Parts resolve in this order; the first rule that applies decides.

1. **Exact project path.** A single part naming an existing project-relative
   file (leading `./` removed) is ranked first, even when completion would
   never offer it — for example an ignored run output. `..` segments are never
   followed.
2. **Absolute or `~/` first part.** `~/` expands against the server's home.
   - Inside the project root (by written or resolved spelling, so a symlinked
     root such as `~/ya` works): it becomes a project-relative anchor, as in
     rule 3, and a named file opens as an exact path.
   - Existing outside the project: a file opens by its absolute path; a
     directory is searched for the remaining parts with its own `.gitignore`
     rules, ignored files only on submit. Both are superuser-only and pass the
     file endpoint's allow-set check; other principals get an error. Nothing
     outside the project is ever searched unless the first part names an
     existing absolute path.
   - Missing: treated as a path from another checkout or machine. Its longest
     suffix, by whole components, that names an existing project file opens;
     a suffix naming a project directory anchors the remaining parts. No
     suffix means no match. This never reads outside the project.
3. **Root anchor.** A first part containing `/` that is a prefix of some
   inventory path from the project root anchors the search: paths must start
   with it, and it is not searched again later in the path. A first part with
   `/` that is no root prefix is an ordinary needle, so `server/app.ts` still
   finds `packages/server/app.ts`.
4. **Ordered needles.** Every remaining part must occur as a substring, in
   order, without overlap: `.*p1.*p2…` over the whole project-relative path.
   Only files match; directories are never results.

## Tiers and ranking

Results are ranked by tier, then by most recent mention in the loaded
transcript (the same confirmed links `@` completion uses), then whether the
last part matched inside the basename, then shorter path, then path order.

| Tier | Badge | Source |
| --- | --- | --- |
| exact | `exact` | Rule 1, 2, or a named suffix |
| tracked | `tracked` | Git index entries (none in a non-Git project) |
| untracked | `untracked` | Other files that no ignore rule excludes |
| ignored | `ignored` | Ignored files, **submit only**, when no other tier matched |
| outside | `host` | Files under an existing outside directory |

Untracked matches follow tracked ones rather than appearing only when no
tracked file matches. With a strict fallback, an untracked file whose parts
also match any tracked path could never be reached from completion.

Tracked and untracked candidates come from the retained `@` completion
inventory and pass its current ignore-rule and existence recheck before being
offered. The inventory resolves the tracked phase first; a response reports
`pending` while untracked paths are still filling, and completion polls. At
most 30 results are returned; a `truncated` flag reports that a budget cut
the match set.

The ignored tier costs one unretained `git ls-files --others --ignored`
listing, so it runs only for a submitted command that found nothing in the
settled inventory. An anchored search limits that listing to the anchor's
directory. It stops after 100 matches, 2,000,000 listed paths, or 8 seconds,
and reports truncation. `.git` contents and paths with control characters are
never results.

## Composer behavior

- **Availability.** The command is offered and intercepted only when the
  server advertises `project-file-view-command` (ID 107), the session is not
  owned externally, and no provider command or skill is named `v` or `view`.
  A live process is not required. Otherwise `/v` text reaches the provider
  unchanged and no search request is made.
- **Completion sheet.** While the single-line draft is `/v` followed by at
  least one part, a sheet floating above the composer lists matches 75 ms
  after the last keystroke, under one heading per tier in ranking order.
  Requests never gate keystrokes. The server returns each result's matched
  spans (`spans`: the root anchor and each part, in order), and the sheet
  marks them in the basename and parent directory. A row whose file was
  mentioned in the loaded transcript is tagged `mentioned` and has a control
  that scrolls the transcript to the item that last mentioned it; mention
  stays a ranking signal within a tier, never a group that outranks tracked
  files.
- **Preview.** The highlighted row's first 12 lines, or the lines around a
  cited `:line`, show beside the list on wide screens and under it on narrow
  ones; cited lines are shaded, and a `…` appears only when the file
  continues past the window. The preview reads one line past its window
  through the file endpoint's existing bounded range view, waits 150 ms for
  the highlight to rest, cancels on change, and keeps the last 24 previews.
  A binary or unreadable file says there is no text preview.
- **Keys.** Arrows (or hovering) move the highlight; Tab or a click replaces
  the argument with the highlighted path, quoted if needed, keeping the line
  target; Right, with the caret at the end of the draft, replaces the query
  with the highlighted file's directory to browse inside it; Ctrl+Enter
  opens the highlighted file and keeps the draft; Escape dismisses.
- **Ignored files.** When the settled result is empty, the sheet offers
  **Search ignored files**, which reruns the query with the ignored tier.
  Enter on an empty result still searches ignored files too.
- **Enter.** With the menu showing a highlighted row, Enter opens that row.
  Otherwise Enter submits the typed parts and the server's rank-1 result
  opens. A submit waits up to 10 seconds for a pending inventory to settle.
  When the opened file came from a search with several matches, an info toast
  names it and the match count; an exact path shows none. In full-pane
  editing Enter keeps inserting a newline.
- **Opening.** The file opens in the session's managed viewer exactly as a
  file link inside the session opens it: same viewer registration, parked
  controller, right-pane support, open-in-new-tab URL, and quote-to-composer
  handler (the transcript publishes it through `quoteTextBlockRef`).
- **Draft.** Submission empties the composer at once, like Send. Opening
  confirms the clear; no match, a bare `/v`, or a search failure restores the
  typed command and shows an error toast. Nothing is sent to the provider and
  no transcript row is written, including during an active turn.
- **Other lanes.** Project Queue refuses `/v` as a composer-only command
  where the command is available (`classifyQueuedYaCommand`
  `fileViewSupported`). Attachments stay in the composer; the command does not
  consume them. Correction mode ends as for other local commands.

## Compatibility

`project-file-view-command` is permanent and version-implied from 0.9.4, with
source-ahead numeric advertisement. The 2026-09-30 optional-feature review
covered v0.9.0, v0.9.1, and v0.9.2 (the latest two stable releases and every
stable release within 14 days); none has the route. Without the capability
the client neither lists nor intercepts `/v` or `/view` and sends no search
request. No existing capability changes meaning; `@` completion responses keep
their shape. The maintainer approved this gate and fallback on 2026-09-30.

## Not covered

- The New Session composer has no session viewer and does not offer `/v`;
  typed `/v` there is ordinary text.
- Git submodules and nested repositories are enumerated as the containing
  repository lists them; files inside them are reachable only by exact path.
- Tracked files that also match an ignore rule are absent from the inventory,
  as for `@` completion, and the ignored scan lists only untracked ignored
  files; such a file opens only by exact path.

## Tests That Should Fail On Contract Regressions

- `packages/server/test/services/projectFileViewSearch.test.ts`: tier order
  with untracked reachable, ordered needles and basename preference, smart
  case, root anchoring versus a non-root `/` needle, exact ignored paths,
  submit-only ignored scan, absolute and `~/` in-project anchoring, the
  other-checkout suffix fallback, and superuser-only outside search.
- `packages/shared/src/__tests__/file-view-command.test.ts`: quoting, line
  targets, and the Tab-inserted form round-tripping.
- `packages/client/e2e/file-view-command.spec.ts`: sequential typing keeps
  every keystroke; the sheet groups the match under its tier, marks each
  part, and previews the file without a false continuation mark; Right
  narrows to the directory; Ctrl+Enter opens and keeps the draft; Enter opens
  with no message sent; **Search ignored files** finds an ignored file; a
  miss restores the draft; a phone-width row click inserts the path.
- `packages/server/test/services/projectFileViewSearch.test.ts` also pins the
  returned spans, and `recentProjectPathLinks.test.ts` the item that last
  mentioned each path.

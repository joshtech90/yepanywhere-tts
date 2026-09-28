# Source-map aware editing of rendered HTML artifacts

Status: initial file/line editor implemented; remaining precision and regeneration
design below is future work. The maintainer accepted approximate original-source
locations and no reliable rebuild trigger for initial delivery. Current behavior
and the supported comment format live in [file source editing](../../topics/file-source-editing.md).
Known defects: [stale line references](../artifact-source-map-staleness.md) and
[rebuild remainder](../artifact-source-edit-rebuild.md), including the unresolved
Plannotator wrapper lifecycle. Regular sanitized HTML defaults to rendered
content and offers Edit mode; without mappings it edits the HTML itself.

Keep this separate from [direct text editing](direct-text-edit-in-viewer.md):
editing a generated artifact needs a reliable path back to its authoring
source and, ideally, a way to regenerate the artifact without a session turn.
Reuse that sketch's editor, conflict detection and optional session notice.
The [artifact review sketch](artifact-review-comments.md#context-and-locating-non-text-targets)
already prefers producer-emitted mappings over reverse engineering rendered
HTML; editing and comments should consume the same mapping convention.

## User flow and layout

An **Edit** action enters source-selection mode. Clicking a word or item in
the rendered HTML opens its authoring source with the caret close to the
clicked position, the relevant range highlighted, and enough surrounding
source to edit comfortably. Ordinary artifact interaction remains available
outside Edit mode. Keyboard users can select a mapped target and open it too.

When launched from the session's right artifact panel, the editing workspace
temporarily fully obscures **both the session and sidebar**. Use the available
width for source and rendered preview, rather than nesting an editor into the
already narrow panel. Preserve the mounted session, composer draft, sidebar
state and artifact reading position; exiting restores the prior arrangement.
When opened in its own tab, use a simple source/preview split without session
chrome. On narrow screens, switch between source and preview within that same
workspace rather than squeezing two unusable columns together. Dirty edits
survive preview switches; leaving offers explicit Save or Discard.

An artifact-only public tab does not gain editing authority from its view URL.
Its Edit entry must open an authenticated YA editing surface for the resource.
This extends the [parked viewer](../../topics/parked-file-viewer.md) and
[session right pane](../../topics/session-right-pane.md) presentation models;
it does not change their ordinary viewing defaults.

## Proposed HTML-comment source-map convention

Define a versioned producer/consumer format before implementation. Use a
standard source map for generated-text to authoring-source coordinates and a
small YA extension for rendered-target to generated-text coordinates.
[ECMA-426 §7.1.2](https://tc39.es/ecma426/2024/#sec-linking-inline)
uses `sourceMappingURL` annotations and invites analogous conventions for
other languages; its specified languages are JavaScript, CSS and WebAssembly.
The HTML spelling and DOM association below are **proposed YA conventions**,
not an existing browser HTML source-map standard.

```html
<!--# sourceMappingURL=report.html.map -->
<!-- ya-source-target:v1 {"id":"summary","generatedRange":[[8,3],[8,42]]} -->
<p>Projected demand rises through September.</p>
<!-- /ya-source-target:v1 summary -->
```

Illustrative coordinates above must be emitted from the final serialized HTML,
including comments. The linked map uses the version-3 source-map shape;
the target extension additionally supplies:

- Stable target id and, for repeated output, distinct instance identity.
- Generated range and original source file/range, with source and artifact
  content hashes binding the records to the rendered revision.
- Text-run mappings from rendered text offsets to generated/original offsets.
  Represent transformations explicitly: HTML entities, collapsed whitespace,
  inline markup, interpolation, and repeated text must not shift the caret to
  an unrelated occurrence. Define zero-based lines and UTF-16 columns/offsets,
  with half-open ranges; editor display coordinates convert at the boundary.
- Optional semantic label and explicit mapping precision: exact character,
  approximate text range, or item only.

The target comment brackets a DOM subtree or sibling range; nested targets
resolve to the smallest containing mapped region. The parser must recognize
actual HTML comments, require matched unique markers, and reject malformed or
ambiguous records. Never interpret comment-like text inside scripts as metadata.
Large text-run tables can live in a versioned sidecar referenced by the comment;
the HTML carries the discoverable mapping link either way. Resolve sidecar URLs
relative to the artifact and source references relative to the map, with
ordinary file-access checks. Do not embed private source contents by default.

Static HTML is the initial scope. Runtime-created DOM needs producer support
that retains target identity and text mappings; a JavaScript build map alone
does not identify which rendered node came from which data/template instance.
Canvas and other non-text content can open a mapped item range only when the
producer supplies a corresponding hit region.

## Paper producer choice: original section file and line

Decision (2026-09-22, user-requested; Contributing-model: 6-Astra): use
the paired `ya-source-target:v1` HTML comments above and a sibling
`paper-canvas.html.map`, rather than introduce a separate paper-only marker.
Implemented first increment (2026-09-22, Contributing-model: 6-Astra): the
paper builder emits paired comments around each included section/subsection,
original `sections/*.qmd` line ranges and source hashes, and a sibling map
with final HTML ranges and the HTML hash. The build receipt hashes the map.
This is explicitly section/subsection precision, not paragraph or character
precision. The version-3-shaped sidecar has empty standard `mappings` and
records ranges in `x_ya_source_targets`; the current viewer reads the comments.
The producer contract and build command live in the draft repository's
`research/pii/frontier/papers/multilingual-pii-redaction/README.md`.
The finer block/word mapping described below remains future work, including
relocated footnotes and bibliography entries. Hash enforcement and automatic
regeneration also remain unimplemented in the viewer.

The concrete producer is the draft repository's `scripts/pii_paper_canvas.py`.
It renders `research/pii/frontier/papers/multilingual-pii-redaction/index.qmd`
with Quarto 1.9.38, whose manuscript includes live in `sections/*.qmd`, then
produces `_build/paper-canvas.html`, its PDF, and a hash receipt. The map must
identify those original section files, not an expanded temporary manuscript,
the include line in `index.qmd`, or the generated HTML line alone.

For the first producer increment, bracket each authored paragraph, heading,
list item, table and figure with a target. A proposed record is:

```html
<!-- ya-source-target:v1 {"id":"abstract:p1","source":"../sections/_00-abstract.qmd","sourceRange":[[2,0],[7,0]],"precision":"item"} -->
<p>…rendered paragraph…</p>
<!-- /ya-source-target:v1 abstract:p1 -->
```

The example range is illustrative, not a claim about current manuscript
lines. `source` resolves relative to the map; `sourceRange` follows the
zero-based, half-open convention above. A viewer displays its start as
`sections/_00-abstract.qmd:3`, selects the source range, and explicitly reports
item-level precision. This useful file/line increment does **not** satisfy
the later click-to-character acceptance requirement.

Implementation direction:

- Capture file identity and block ranges while reading the original section
  sources, before include expansion and Markdown transformations. Carry that
  provenance through parsing/rendering. First verify the pinned Quarto/Pandoc
  extension seam preserves it; do not assume its default AST supplies original
  include coordinates. Do not recover provenance with a global rendered-text
  search, paragraph-count alignment, or a blank-line splitter.
- Preserve target identity using explicit authoring anchors where present;
  establish persistent block identifiers for unanchored material. A line number
  or paragraph ordinal alone is not stable identity across edits. Repeated
  inclusions need distinct instance identifiers.
- Serialize the paired comments without changing the visible document. After
  final HTML serialization, derive generated ranges and the version-3 map,
  with a versioned YA target-table extension for original ranges and precision.
  Initially map only known boundaries; leave interiors unmapped rather than
  suggesting character accuracy. Excluded author-only sections have no targets.
- Hash the final HTML and original source bytes in the sidecar, and hash the
  sidecar in the existing build receipt. Keep the map URL in HTML but its digest
  outside HTML to avoid a circular HTML/map hash dependency. Publish the HTML,
  map and receipt together; do not embed source contents or absolute host paths.
- Cover moved footnotes and bibliography entries with their own source targets
  where provenance is known; synthetic navigation and generated decorations
  remain explicitly unmapped. Later text-run mappings refine the same targets.

Producer acceptance: build a fixture with two included section files, repeated
phrases, inline markup, a footnote and an excluded block. Every mapped visible
block resolves to its original file/range; a source edit makes the old mapping
stale; generated ranges address the final serialized HTML; comments do not
change screen or print output. Test the actual embedded HTML review path for
marker survival before claiming a review consumer can use them. Existing
Plannotator integration is not presumed to interpret this proposed YA format.

## Click precision: more than the right line

Resolve the click to a rendered text caret offset, then through its mapped
text run to the original source caret. A clicked word late in a long source
line must open near that word, not at column zero or the start of its paragraph.
Here “approx edit distance” means proximity to the intended editing position;
string edit-distance matching may help alignment but is not the requirement.

For an exact text run, place the caret at the corresponding character. For a
transformed run, choose the nearest mapped boundary within that run and mark
the placement approximate. For an item with no character mapping, select the
item's source range and say that precision is item-level. A global text search
or opening only the file/line does not satisfy the text-click requirement.
Resolve template-versus-instance ambiguity visibly rather than silently editing
a shared template when the user clicked one instance's data.

Pin the click and mapping to the loaded artifact revision. Before saving,
compare the source revision with the opened baseline; stale mappings or a
concurrent edit require refreshed mapping/conflict resolution. Do not guess a
writable location after verification fails. Metadata locates content; it never
grants permission to read or write a path. Source saving inherits the direct
editor's explicit-write and same-content precondition requirements.

## Optional round trip through a registered regeneration hook

Keep regeneration independently deliverable from click-to-source editing.
The desired complete loop is **click → edit source → Save and regenerate →
updated preview**, entirely through YA and a registered script, without asking
an agent to take a session turn. Plain Save may leave the preview visibly stale.

Proposed discovery metadata:

```html
<!-- ya-artifact:v1 {"regenerate":{"hook":"report-build","registrationVersion":1}} -->
```

The hook id resolves to a project-scoped registration containing the script,
argument vector, working directory, allowed inputs/outputs and execution
limits. Registration records approval of that executable configuration;
loading an HTML comment does not register or authorize an arbitrary command.
An artifact may carry a proposed script descriptor for explicit registration,
but the run uses the registered definition. Changed script/config identity
invalidates that approval. Registration storage follows
[project directory storage](../../topics/project-directory-storage.md).

[UI export metadata](../../topics/ui-design.md#export-contract) already has a
descriptive `regenerate` command in `ya-mockup.json`. Reuse that as a discovery
input where useful; it currently is not an execution registration. Avoid two
independent hook definitions in the manifest and HTML comment.

Save and regenerate runs the hook on the source-owning host through a bounded,
server-owned job. Show running, success, failure and logs; support cancellation
and reconnection without tying the process to a mounted editor. Serialize runs
per artifact and associate each result with its saved input revision so an
older build cannot overwrite a newer preview. Publish the new HTML, assets and
mapping as one revision only after success. On failure retain saved source,
the previous successful preview, and an explicit “preview out of date” state.
Restore the selected target and approximate reading position using its stable
identity when it survives regeneration.

The isolated artifact frame reports selections through a validated bridge;
authenticated YA owns source writes and hook invocation. Viewing, clicking an
ordinary link, or receiving a frame message alone must never run a script.
Hook registration UX, exact schemas, output publication and job-owner reuse
remain implementation-design questions. They may become a separate linked
sketch if regeneration grows beyond this artifact-editing use case.

## Acceptance examples for a later implementation

1. Click near the end of a long rendered sentence whose source is one long
   line: open at the corresponding word/character, including entities, emoji,
   nested emphasis, whitespace collapse and repeated phrases.
2. Click the third repeated item: resolve that instance's data or explicitly
   offer its shared template. Show honest precision for transformed content.
3. Reject stale source hashes and mismatched artifact maps; preserve edits
   when a concurrent writer changes the source or regeneration fails.
4. From the right pane, obscure session and sidebar during editing, then
   restore their drafts and positions. In a separate tab, show the split.
   Verify desktop and phone captures and real sequential typing under live
   session updates, with every keystroke visible within 100 ms.
5. Save and regenerate through a registered hook with zero provider turns;
   prove failure/cancellation preserves the last successful artifact, and an
   older run cannot publish over a newer result. Unregistered metadata cannot
   execute a command.

Found 2026-09-22 while requesting source-map aware artifact editing.
Contributing-model: 6-Astra

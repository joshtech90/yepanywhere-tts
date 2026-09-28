# A large HTML selection preview still costs several document-sized copies

The source editor's selection preview for a mapped HTML artifact
(`SourceEditor` in `packages/client/src/components/SourceEditor.tsx`,
`prepareArtifactEditPreview` and `createArtifactEditDocument` in
`packages/client/src/lib/artifactSourceTargets.ts`) now parses the received
HTML once and keeps only the target list and one serialized snapshot. For a
document near the 200 MiB preview limit the tab still holds, at peak:

- the transport's JSON response text and the parsed `content` string, while
  `GET /api/file-edit?preview=1` returns the whole document as a JSON string
  (`routes/file-edit.ts`); the rebuild route returns the whole re-read
  document the same way;
- the one parsed `Document` during preparation;
- the retained serialized snapshot, plus the frame document string built
  from it; and
- the preview frame's own DOM.

After a refused approval, `refreshRebuildStatus` also re-fetches the whole
preview only to read its `regenerate` status.

Why not fixed in place: harsh review [13-10] (F72) chose the bounded trim.
The `srcdoc` delivery is inherent while relay clients cannot load the preview
by URL, and each remaining direction changes a contract:

- Extract targets and build the annotated snapshot on the server, which
  already holds the file: needs a server HTML parser whose tree matches the
  browser's, since targets count only real DOM comments.
- Let the nonce-authorized script inside the frame annotate its own document
  and report targets, so the parent never parses: sanitization then moves from
  DOM stripping to CSP alone, which does not stop a producer
  `<meta http-equiv="refresh">` from navigating the frame; this needs a
  security review.
- Cap the in-editor selection preview well below 200 MiB (the PII paper
  canvas that motivated it is about 5 MiB), lowering the topic's promise.

A cheap independent piece: a status-only read for `refreshRebuildStatus`.

Found 2026-09-26 while fixing harsh review [13-10] (F72).

# Parent-relative Markdown links lose their anchors in document previews

The standalone file viewer renders `[label](../gaps/sketches/proposal.md)`
as plain text even when the target exists in the same project. This was
reproduced through the real E2E file route using a document under `topics/`.
Both ordinary and inline-code labels lost their anchors.

`resolveLocalMarkdownHref` in `packages/server/src/augments/safe-markdown.ts`
rejects every normalized path containing a `..` segment before resolving it
against `localFileBasePath`. The fallback URL sanitizer does not preserve the
relative link. This is separate from the faint clickable-code affordance:
other rendering paths and absolute links can still produce working anchors.

Resolve parent-relative references under the owning file-access boundary;
do not simply remove the guard without checking containment and public-share
semantics. Verify same-project parent navigation, denied outside references,
and ordinary sibling links through both renderer tests and the file viewer.

Found 2026-09-14 while verifying document link affordances.

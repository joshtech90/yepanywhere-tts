# No SVG sanitizer, and nothing marks the bypass as review-gated

YA allows a reviewed renderer to put inline SVG into a trusted document; see
`topics/active-content-security.md` § Sanitized rich-text fragments and
`topics/code-fence-renderers.md`. Two things are missing underneath that
decision, and both only bite when a renderer has *not* been reviewed.

**There is no SVG sanitizer to hand such a renderer.** The shared
`sanitize-html` configuration in
`packages/server/src/augments/safe-markdown.ts`
lists no SVG elements in `allowedTags` and no SVG attributes in
`allowedAttributes`. So the options available today are inline it unsanitized,
or lose it entirely. Nothing in between exists, which makes "sanitize it
instead" an unavailable answer rather than a rejected one.

**The bypass is a copyable pattern, not a gated one.** KaTeX gets its
`span`/`svg` markup into the output by emitting a placeholder span, letting
sanitization run, and substituting the real markup back afterward —
`storeKatexPlaceholder` and `katexBuffer` in the same file. The comment there
explains the mechanism but does not say the arrangement is contingent on KaTeX
having been reviewed. A later renderer can reproduce the pattern in a few lines
and inherit sanitizer bypass without anyone having decided it deserved it, and
no type, test, or single list of reviewed renderers would show that in review.

The registry proposed in `topics/code-fence-renderers.md` makes adding a
per-language renderer cheap, which is the point of it, and also the reason
these two absences are worth closing before the second or third renderer
arrives rather than after. A renderer whose markup derives from a share or an
upload rather than from agent text is the case that most wants a real
allowlist.

The cheap fix, in the order that helps:

1. Name the bypass. Replace the copyable pattern with one documented entry
   point that states it is for reviewed renderers only, and keep the reviewed
   set in one place so adding a member is a visible diff.
2. Add the SVG allowlist when the first unreviewed renderer needs it: shape,
   text, and grouping elements plus geometry and presentation attributes.
   Exclude `script` and `style`, `foreignObject`, `on*` handlers, and
   `href`/`xlink:href` targets other than same-document fragments.

Not fixed in place because the adjacent work was code-fence language
normalization and a design proposal, and neither absence blocks Mermaid, which
is a reviewed renderer.

Found 2026-09-09 while settling the security question in
`topics/code-fence-renderers.md`.

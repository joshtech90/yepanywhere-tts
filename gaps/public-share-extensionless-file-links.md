# A public share can link an extensionless project file it will not serve

Share transcripts now carry project-file links (`topics/project-path-links.md`
§ Public shares). Whether a path becomes a link and whether the share will
serve it are decided by two different tests, and they disagree for a file whose
name has no extension:

- Linking asks the project path index / `statSync` whether the file exists —
  `renderProjectFileCodeLink()` in
  `packages/server/src/augments/safe-markdown.ts` applies no name-shape rule at
  all, and `linkifyProjectPaths()` still links a shape-gated token when the
  index already holds the answer.
- Serving asks whether the session text *mentions* the path, and
  `relativePathPattern` in
  `collectPublicShareMentionedProjectFiles()`
  (`packages/server/src/routes/public-shares.ts`) requires a trailing
  `.<1-16 chars>`.

So an assistant turn saying `` `Makefile` `` renders a link in the share whose
click returns "Invalid file path". Paths with extensions — the common case, and
the one the feature was reported against — agree on both sides.

Not fixed in place because the disagreeing rule is the share's authorization
scan, and widening it is a security-relevant change that deserves its own
commit and its own reasoning about what a bare word in a transcript authorizes.
The cheap fix is probably to let the mention scan accept a token the project
path index confirms, rather than to relax the regex.

Found 2026-09-15 while giving live and frozen shares the same project-path file
links the authenticated session shows.

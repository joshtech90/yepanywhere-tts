# Rough edges left by split file:line links

Visible `path:42` links render as two links: the path opens the file at the
top and `:42` opens it at the line
([project-path-links](../../topics/project-path-links.md), "A visible cited
position is its own link"). Two small leftovers are judged too low-value to
pursue unless they start to annoy:

- **Stale tooltip on the path half.** Server-rendered Markdown anchors carry
  a `title` of `relativePath:line` (`renderProjectFileLinkOpen` in
  `packages/server/src/augments/safe-markdown.ts`). After the client split
  (`splitOwnCitedPosition` in `packages/client/src/lib/projectPathLinks.ts`),
  the path half keeps that title even though clicking it opens the file at
  the top. A suffix created from following text (`linkFollowingCitedPosition`)
  likewise gets no `:N` in its title. A fix rewrites the title's first line
  inside `setFileLinkPosition`, which needs to handle both the project-file
  title format and the bare local-file `path:N:C` format.
- **Grep-style absolute output stays unlinked.** An absolute token runs to the
  next whitespace, so `/a/b.ts:12:match` is one token. The server probes only
  the whole token and a trailing `:N`, `:N-M` or `:N:C` suffix
  (`absoluteTokenTargets` in `packages/server/src/augments/project-path-links.ts`),
  so this line links nothing. Relative grep output (`src/b.ts:12:match`)
  already links and splits. A fix would also try the prefix ending at the
  first cited position inside the token, within the existing 64-probe budget,
  and the client would then need to link only that prefix of the token.
  This existed before the split.

Found 2026-10-18 while landing the split.

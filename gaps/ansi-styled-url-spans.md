# A URL split across ANSI colour runs is not linkified

`escapeWithLinks` in `packages/shared/src/ansi-renderer.ts` linkifies each
styled run on its own, so a URL that a tool prints with a colour change inside
it arrives as two or more runs and none of them is a whole URL. Nothing links,
and the text still reads correctly, so the failure is silent.

Two shapes produce it: a tool that underlines or recolours the host inside a
link, and a progress display that rewrites part of a line. Plain output and
output whose URL sits inside a single run, which is nearly all of it, already
link.

The fix is to linkify across the assembled run sequence rather than inside each
run: collect the runs with their styles, find URL spans over the concatenated
text, then re-emit the anchor around whatever style boundaries it crosses.
That means the renderer stops being a per-run `map` and needs a second pass,
which is why it was not done in place.

Found 2026-09-11 while making URLs clickable in fixed-font contexts; the
maintainer explicitly deferred this case.

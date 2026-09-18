# Mobile history search loses an already-typed prefix in browser validation

The full `pnpm test:e2e` run on 2026-09-16 failed in
`packages/client/e2e/session-history-isearch.spec.ts:60`, in the mobile-width
case. Sequentially typing `horizon needle` produced `o` when the textbox
should contain `ho`. The assertion still saw `o` at its 100 ms deadline.

This is evidence of a lost prefix, not merely slow search results. Keep the
100 ms sequential-typing check. Investigate input focus/selection, remounts,
and state updates around activating reverse search while history loads; the
run does not establish which caused it. The desktop case passed. Repeatability
has not been established.

Local evidence is under
`packages/client/test-results/4fe359cf-c189-4d43-b983-d158c7c8aabe/session-history-isearch-co-76c77-ded-history-at-mobile-width/`
(`test-failed-1.png` and `error-context.md`). This path is independent of the
post-compact prompt builder, so it was captured rather than folded into that
change. Reproduce with the owning Playwright spec before choosing a fix.

Found 2026-09-16 while validating quoted post-compact replay.

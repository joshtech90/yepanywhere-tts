# Usage cost prices go stale silently, and a fast-mode turn is priced at half

Settings → Users prices recorded token usage from two tables read in order:
`PUBLISHED_MODEL_PRICES` in `packages/shared/src/model-prices.ts`, read from the
providers' own pricing pages on 2026-09-21, and behind it the vendored extract of
pi's rates in `packages/shared/src/vendor/pi-model-prices/`. Four things are left
open, none of them blocking the report:

- **Nothing notices either table aging.** The vendored extract is refreshed only
  when someone runs `scripts/generate-vendored-model-prices.mjs` against a local
  `pi` checkout, and the published table only when someone rereads the pricing
  pages. A report drawn from a year-old table reads exactly like a current one.
  The output-token equivalent is deliberately the headline partly for this
  reason — it survives a price change — but the dollar figure does not, and says
  nothing about how old it is. Cheap fix: carry each table's read date and show
  the older of the two beside the dollar figures.
- **A fast-mode Claude turn is priced at half.** Anthropic's fast mode bills
  Opus 5 and Opus 4.8 at $10/$50 per million instead of $5/$25, and Opus 5.5
  at $8/$40 instead of $4/$20 (rechecked 2026-09-28), across the whole
  context window. YA has a fast-mode concept, but the ledger records only model
  and provider, so such a turn is indistinguishable from a standard one and
  costs out at half. Fixing it means recording the request speed alongside the
  context tier — the same shape as the tier bin, so the seam already exists.
- **Prices with modifiers YA does not record.** Beyond fast mode: Anthropic's
  1-hour cache writes cost 2x base input rather than 1.25x and are reported
  separately by the API, `inference_geo: "us"` adds 1.1x, and the Batch API
  halves everything. None are recorded, so a turn using them is priced at the
  standard rate. All three are unlikely in YA's interactive path, which is why
  this is a note rather than a defect.
- **Unlisted models get no dollar figure at all**, by design — they fall back to
  generic ratios for the output-token equivalent only
  (`unlistedEquivalentOutputTokens`). A per-project or whole-user bucket that
  contains even one unlisted model therefore shows no dollars. That is the honest
  reading, but it means a mixed install can see its project-level cost figures
  disappear entirely. Whether to show a partial total with an explicit "plus
  unpriced usage" marker is a product call nobody has made.

Not fixed in place because each needs a decision rather than code: how fresh a
table must be to quote dollars, whether the ledger should carry request speed,
and how to present a partial cost.

Two things that *were* verified rather than left open, recorded so nobody
re-derives them: Anthropic removed its over-200k long-context premium on
2026-03-13 and now prices the full 1M window flat, so Claude has no provider
context tier; and OpenAI's tier starts above 272k, not 200k. Both are encoded in
`CONTEXT_TIER_BY_UPSTREAM_PROVIDER`. The one Claude exception, Haiku 5.5 (×5
above 100k, published 2026-10-08), is a per-model tier in
`CONTEXT_TIER_BY_MODEL`.

Found 2026-09-21 while adding per-model and per-project token cost to
Settings → Users usage.

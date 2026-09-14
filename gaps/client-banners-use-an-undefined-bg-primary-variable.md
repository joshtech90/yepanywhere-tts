# Client banners style themselves with `--bg-primary`, which no client theme defines

`ProviderHostDegradedBanner.module.css:9` sets `color: var(--bg-primary, #111)`,
and several client rules reach for the same variable
(`packages/client/src/styles/index.css:2467`, `:3360`, `:5604`, `:6723`,
`:7782`, `:7954`, `:8012`). No client theme block declares it: the only
definitions in the repository are in `site/src/index.css:2` and `:14`, which
belong to the marketing site and are never loaded by the app.

So every one of those rules silently takes its fallback, and the ones with no
fallback — the `color-mix` and gradient uses in `index.css` — resolve to an
invalid value and drop the declaration. The degraded-provider banner happens to
stay legible because `#111` on the red error color is fine, which is why this
has gone unnoticed.

The fix is a decision, not a rename: either declare `--bg-primary` in each
theme block beside `--bg-surface` and friends, or sweep the seven call sites
onto the variable each one actually wanted. Both need a look at the rendered
result in every theme, so this did not belong inside an unrelated change.

Found 2026-09-10 while styling the network-filesystem storage banner, which
copied the neighboring banner's colors before the variable turned out to be
undefined.

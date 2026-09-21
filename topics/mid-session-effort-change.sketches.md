# Mid-session effort change — sketches

Candidate designs outside the binding contract in
[mid-session-effort-change.md](mid-session-effort-change.md).

## Per-model enablement and thresholds

The shipped setting is per provider. A per-model layer would let the
threshold or the enablement differ by model (for example, a small model whose
prompt is cheap to re-read, or Astra once its in-place update is usable),
keyed the way `clientDefaults.compactAtContextPercent` keys by YA model id.

Deferred 2026-09-19 by the maintainer: land the per-provider slider and
checkboxes first; the model dimension waits until a model-specific need is
observed. If added, keep the provider row as the default and let a model row
override only the fields it sets, so an unlisted model inherits its provider.

## Warning on thinking-mode changes that keep the effort

`auto` ↔ `off` does not trip the warning today because neither carries an
effort component. Whether toggling adaptive thinking on or off also changes
the rendered system prompt on Claude has not been measured; if it does, the
trigger widens to any change of the thinking option.

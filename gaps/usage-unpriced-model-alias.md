# Usage records the bare "opus" alias, which no price covers

Settings → Users usage on this install lists a model named `opus` with
2,638M tokens of volume, the largest of any model, and no output-token
equivalent or dollar estimate. `claude-opus-5-5` beside it is priced. The
recorded name looks like the launch alias (`opus`) rather than the resolved
model id the provider actually served, so the price table cannot match it.
The same gap removes the cost from every project that ran it: `yepanywhere`
and `draft` show volume only.

Where to look: the model name the usage ledger stores per request
(`readBillableUsage` in `packages/server/src/sdk/billableUsage.ts`, and the
ledger writer it feeds), versus the resolved model the provider reports in
its result message. Recording the resolved id fixes new entries. Existing
ledger rows would need an alias mapping at report time, which is safe only
where the alias resolved to one model over the whole period.

Found 2026-09-28 while turning the usage summary into tables. Not fixed
there: it is ledger attribution, not presentation.

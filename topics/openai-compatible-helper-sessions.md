# Retired OpenAI-compatible helper targets

Topic: openai-compatible-helper-sessions

## Disposition

Removed 2026-10-27 under [core house cleaning](core-house-cleaning.md), row 4.
The unfinished target registry, hidden settings editor, model discovery route,
selector helpers and schemas are retired. No working endpoint execution was
removed: the registry never supplied that runtime.

Saved target configuration is omitted from settings and has no effect. The
removed discovery route is unavailable; stale settings writes cannot revive
it. A saved `helper-target:<id>` side-model selection does not become a
provider model or silently fall back to another endpoint/model: side-session
recap generation returns a controlled refusal requesting a provider-local
model, before calling the provider summarizer. Historical sessions remain
readable. `Cheapest`, `Same as main session` and concrete provider-local models
continue to work for retained recaps and helpers.

## Future candidate, upon first need

For a concrete prompted UI-helper or text-processing consumer, consider an
in-house, no-tool provider managed by the provider server: supplied prompts/text
in, helper output out, without tool execution. Add it only with its first
consumer. It is not a cleanup or core-refactor prerequisite, and the removed
registry/selector format does not constrain it.

[Plan 164](../docs/tactical/164-remove-retired-session-automation.md) records
verification. The saved-setting roundtrip and provider-dispatch regression
protect retirement; existing recap/model tests protect the retained choices.

# Claude's live catalog puts previous models in the primary chooser

Claude Code 2.1.283 (Agent SDK 0.3.283) answers `supportedModels()` with
eleven rows instead of five. Besides the current aliases it lists concrete
previous versions: `claude-opus-5`, `claude-fable-5`, `claude-opus-4-8`,
`claude-opus-4-7`, `claude-opus-4-6`, and `claude-sonnet-4-6`.
`mergeClaudeModels()` in `packages/server/src/sdk/providers/claude.ts` passes
every unrecognized live row through, so all six become primary chooser rows
without the **Previous models** grouping.

That contradicts the contract in
[older-claude-models](../topics/older-claude-models.md): previous models are
individual, default-off opt-ins, and the registry deliberately omits 4.7. It
also defeats the opt-in projection: `projectClaudeAdditionalModels()` skips a
selection whose id is already visible, so an enabled `claude-opus-4-8` loses
its `catalogGroup: "additional"` marking. The static context resolver sizes
the 4.x rows at 200K, which is not live evidence.

This was not fixed during the SDK refresh because the product answer is a
choice. The live catalog is meant to stay primary, and the previous-model
contract predates upstream listing old versions. Options:

- demote every concrete live row other than the one each stable alias folds
  into to `catalogGroup: "additional"`, shown only when opted in;
- or group them as previous models while showing them by default.

Either way the older-claude-models contract and the registry need updating.
`yaModelIdForReported()` maps by family only, so a running
`claude-opus-4-8` session is labeled `opus`. Revisit that mapping when
concrete rows become selectable.

Found 2026-09-26 while refreshing Claude Code 2.1.283 / Agent SDK 0.3.283.

# Context breakdown proposal

Review-only fixture for the context-usage popover behind the composer's
context pie (`src/components/ContextUsagePopover.tsx`). The user requested a
mockup on 2026-09-30 of a `/context`-style breakdown. It makes no server or
provider requests; figures are fixed sample data from a Sonnet 5 session with
a 1M window.

The production implementation is documented in
[context breakdown](../../../../topics/context-breakdown.md). It departs from
this fixture: the Conversation split comes from the provider's own message
breakdown rather than a YA transcript estimate, there is no **Count exactly**
button (the popover always requests the exact count), and the popover keeps
its shipped 320px width. The fixture remains the original proposal.

The proposed data source is the Claude Agent SDK's
`query.getContextUsage({ detail })`, which returns the same categories
`/context` prints plus per-item lists (`memory_files`, `skills`, `mcp_tools`,
`agents`). Rows are relabelled for YA readers and classified by the SDK's
`kind`, never by its English name:

| Shown as | SDK row | Contents |
|---|---|---|
| Harness prompt | System prompt | Claude Code's own system prompt |
| Tool definitions | System tools | Tool schemas/descriptions, not tool calls |
| Instruction files | Memory files | CLAUDE.md chain (and auto-memory if enabled) |
| Skill index | Skills | Skill names/descriptions; invoked bodies are Conversation |
| Conversation | Messages | Prose, tool calls/results, injected reminders |

The Conversation split is **not** SDK data. It would be a transcript-side
estimate by YA, labelled as such. The popover opens with `detail: 'summary'`
(last response's usage plus local estimates); **Count exactly** requests
`'full'`, which makes one token-count API call per category. The window meter
shows occupancy plus the hatched autocompact reserve; the composition bar
scales to the used tokens only, since at 7% occupancy a window-scaled bar is
unreadable. Sessions without a live YA-owned Claude process show the
unavailable state and keep the existing last-turn rows.

The purple Conversation colour is fixture-local; YA has no fourth neutral
categorical token. The popover is 344px wide, versus the shipped 320px.

## Build and capture

From the repository root:

```sh
pnpm --filter @yep-anywhere/client exec tsc -p mockups/context-breakdown/tsconfig.json
pnpm --filter @yep-anywhere/client exec vite build --config mockups/context-breakdown/vite.config.ts
pnpm exec tsx packages/client/mockups/context-breakdown/capture.mts collapsed
pnpm exec tsx packages/client/mockups/context-breakdown/capture.mts expanded
pnpm exec tsx packages/client/mockups/context-breakdown/capture.mts unavailable
```

Open `.artifacts/mockups/context-breakdown/index.html` in YA's file viewer;
the top-row buttons switch states and category rows expand in place.

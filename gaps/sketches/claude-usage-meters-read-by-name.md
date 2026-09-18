# YA maps Claude usage windows by name instead of rendering the server's meters

YA's Claude subscription indicator reads a fixed list of named fields out of
the usage control reply — `five_hour`, `seven_day`, `seven_day_oauth_apps`,
`seven_day_opus`, `seven_day_sonnet`, and `model_scoped` — in
`normalizeClaudeSubscriptionUsage`
(`packages/server/src/sdk/providers/provider-subscription-usage.ts:129`). The
same reply carries a server-authored meter list intended to be rendered as
sent, plus spend and attribution detail YA never looks at.

Nothing is broken: the maintainer confirmed on 2026-09-16 that the current
display — the Fable-scoped window plus the five-hour and seven-day windows —
is what they want for now. This entry records the available shape so that
surfacing more later is a product decision rather than a rediscovery.

## What the reply actually carries

Observed live on 2026-09-16 from a no-turn
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` control request
against Claude Code 2.1.273 / Agent SDK 0.3.273, on a `max` plan:

| Field | Example content | YA today |
|---|---|---|
| `rate_limits.limits[]` | `{kind: "weekly_scoped", group: "weekly", percent: 100, severity: "critical", is_active: true, scope: {model: {display_name: "Fable"}}}` | unread |
| `rate_limits.spend` | used minor units, cap, balance, auto-reload, `can_purchase_credits`, `can_toggle`, disclaimer copy | unread |
| `rate_limits.seven_day_breakdown` | this week attributed across Claude Code 88%, Cowork 11%, Chats 1%, Other 0%, with `window_started_at` | unread |
| `rate_limits.member_dashboard_available` | `false` | unread |
| `rate_limits.extra_usage` | overage enablement, monthly limit, used credits, currency | unread |
| further named buckets | `nimbus_quill`, `tangelo`, `cedar_ember`, `juniper_tide`, … — about a dozen, all null for this account | unread |
| `five_hour`, `seven_day`, `model_scoped` | 13%, 89%, Fable 100% | rendered |
| `seven_day_oauth_apps`, `seven_day_opus`, `seven_day_sonnet` | null on this account | mapped, nothing to show |

`behaviors` — per-day and per-week request-category aggregates plus top
agents, skills, plugins, and MCP servers — is also populated, including in a
session that has sent no tokens. `0.3.273` added an optional `skipBehaviors`
to the control call; YA deliberately does not pass it, so declining that
payload never becomes an obstacle to showing it.

## Why the meter list is the interesting one

The SDK documents `limits[]` as the server's own rows: "which meters apply,
their scope, labels, severity and order are the server's, so a client renders
them verbatim and a new meter needs no client release" (`sdk.d.ts`,
`SDKUsageReport.rate_limits.limits`). YA's by-name mapping is the opposite
contract — a meter Anthropic adds tomorrow stays invisible until someone edits
YA, and the dozen null buckets above are exactly the placeholders that will
fill in. Rendering the rows as sent would also give the indicator `severity`,
so a window at 100% could read as critical rather than as an unqualified
number.

Two cautions for whoever picks this up. The declared control-reply type
(`SDKControlGetUsageResponse`) does not list `limits`, `spend`,
`seven_day_breakdown`, or `member_dashboard_available`; only the
result-frame twin `SDKUsageReport` declares `limits`. All four arrive at
runtime anyway, so consuming them means the same tolerant record reading
`provider-subscription-usage.ts` already does, not a typed field access. And
the row labels are server copy in the server's language, which is what makes
verbatim rendering safe — do not re-map them into YA vocabulary.

The shape and the probe that produced it are recorded under "Current source
refresh, 2026-09-16" in [provider refresh](../../topics/provider-refresh.md).

Found 2026-09-16 while refreshing the Claude runtime to Claude Code 2.1.273.

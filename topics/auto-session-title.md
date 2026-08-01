# Auto Session Title

> Automatic session titles name a new session from its opening turns with the
> provider's cheapest helper model, so the session list reads as a list of
> topics instead of a column of truncated first messages.

Topic: auto-session-title

Related topics: [session-retitle](session-retitle.md), [recaps](recaps.md),
[side-session-config](side-session-config.md),
[provider-abstraction](provider-abstraction.md).

## Why

A session's default title is its first user message, truncated to 120
characters (`truncateSessionTitle`). Inside one session that is fine. In the
session list it is a poor key: sessions that open with the same boilerplate
("Antworte ausschliesslich m…") are indistinguishable, and the actual subject
is often past the cutoff. The user cannot tell their own sessions apart.

Automatic titles fix the list without changing what a session *is*: the
generated name is stored as the session's `customTitle`, exactly where a manual
rename would go.

## Contract

- **Never overwrite a user title.** A session with a `customTitle` is skipped,
  and the check is repeated immediately before the write, so a rename that
  lands while the helper is running still wins.
- **At most one attempt per session per server lifetime.** A failure is
  recorded, not retried; a broken provider must not turn into a retry loop.
  The one exception is "not enough messages yet", which re-arms so a session
  that was too young at first is still titled once it grows.
- **Never pollute the transcript.** Generation runs through the `side-session`
  strategy: a non-persisted, single-turn helper query. No fork is created and
  no stopped session is reactivated, unlike the manual retitle route.
- **Never fan out.** One helper query runs at a time
  (`MAX_CONCURRENT_TITLE_JOBS`), and sessions whose last activity is older than
  `AUTO_SESSION_TITLE_MAX_AGE_MS` (24h) are ignored unless `backfillExisting`
  is on — the session index emits `session-created` for every session it
  indexes on a cold start, so without the age gate the first start after
  enabling would try to title the whole history.
- **Off by default.** It costs helper tokens on every new session, so the user
  opts in.

## Flow

1. `AutoSessionTitleService` subscribes to `session-created` /
   `session-updated` on the event bus, which covers sessions started anywhere —
   in YA, or in a terminal that YA only watches.
2. Cheap rejects first, from the event alone: feature off, session already
   handled, session too old, session already has a custom title.
3. A debounce of `delaySeconds` (default 20s) lets the opening settle, so the
   helper sees a real exchange instead of a half-written first message.
4. The session summary is read. If it has fewer than `triggerMessageCount`
   messages (default 2 — the first user turn plus the first agent reply) the
   attempt is abandoned and re-armed for a later update.
5. The excerpt (first user message + first agent turn) goes to
   `supervisor.generateSummary(provider, { purpose: "session-retitle",
   strategy: "side-session", ... })` with the `cheapest` helper model token,
   which maps to Haiku for Claude and a mini model for Codex.
6. The reply is normalized (`normalizeGeneratedSessionTitle`) — helper models
   add preambles, `Title:` labels, quotes and trailing periods despite the
   instruction — stored via `SessionMetadataService.setTitle`, and announced
   with `session-metadata-changed` so open clients update live.

## Settings

`autoSessionTitle` in server settings (`~/.yep-anywhere/settings.json`,
`GET`/`PUT /api/settings`):

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master switch |
| `triggerMessageCount` | `2` | Messages required before titling (1–20) |
| `delaySeconds` | `20` | Settle delay after the trigger (0–600) |
| `maxLength` | `48` | Target maximum title length (16–132) |
| `language` | `"auto"` | `auto` mirrors the user's language; `de`/`en` force one |
| `backfillExisting` | `false` | Also title sessions older than 24h |

Partial `PUT` bodies merge onto the stored value, so toggling `enabled` does
not reset the other fields.

## Provider support

The `session-retitle` + `side-session` request variant is implemented by the
Claude and Codex providers. A provider without it throws from
`generateSummary`, which the service records as a failed attempt for that
session and otherwise ignores.

## Relationship to manual retitle

[session-retitle](session-retitle.md) stays the user-driven, high-quality path:
it forks the real session so the helper sees the whole transcript, and the
proposal is only applied on explicit confirmation. Automatic titles are the
cheap first-impression pass. A manual retitle always overrides an automatic
one, and once a session carries a user-set title the automatic path leaves it
alone forever.

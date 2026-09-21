# "Reader for this session's provider" is spelled three ways

`getSessionSourceForProvider` (`packages/server/src/sessions/provider-resolution.ts`)
now owns the question for the issue feature: map the provider name to its group,
build that group's source, return null rather than another provider's reader.
Two other callers still answer it themselves:

- `packages/server/src/sessions/provider-child-sessions.ts:43`
  (`readerForProviderChildren`) takes `getSessionSources(project, deps,
  provider, catalog)[0]?.reader`. The provider argument only moves its group to
  the front of the candidate list, so when that group has no reader in the
  project the first candidate is a different provider's reader — the shape
  fixed in the issue caller, still live here.
- `packages/server/src/services/voice/vocabulary-sessions.ts:41` matches
  `candidate.provider === row.provider` first and falls back to a catalog-family
  match, then throws when neither hits. That is the third rule, and its exact
  name comparison is the one that misses a Claude-family session whose recorded
  name differs from the project's (`claude-gateway` in a `claude` project).

Not fixed in place: each caller wants a different answer for "no reader here"
(undefined, a throw, null), and changing what they return is a behaviour change
in features this item did not open. Cheap fix when one of those seams opens:
call `getSessionSourceForProvider` (it already takes the provider catalog the
child-session path passes) and keep the caller's own no-reader behaviour at the
call site.

Found 2026-09-19 while fixing harsh-review a08cc4a9..69501d94 item A21.

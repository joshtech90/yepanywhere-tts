# Gemini ACP resume failure starts a different session

`GeminiACPProvider` in
[`packages/server/src/sdk/providers/gemini-acp.ts`](../packages/server/src/sdk/providers/gemini-acp.ts)
catches a rejected `client.resumeSession(...)` and calls `client.newSession(...)`
instead. A requested continuation can therefore emit a fresh provider session
id and run without the requested conversation's context. The shared client
uses ACP's unstable resume method. This finding is from source inspection;
no live failed-resume reproduction was performed in this review.

The [Gemini freeze](../topics/core-house-cleaning.md#frozen-gemini-and-future-antigravity-support)
is not a compatibility endorsement. If execution is retained, resume failure
should fail explicitly rather than substituting a new session; check that
behavior with a controlled failed-resume peer. If Gemini is retired instead,
remove its execution path and preserve readable history plus explicit launch
refusals. Neither choice should grow the queued-compaction refactor's scope
into a Gemini protocol refresh. No runtime change is made by recording this
finding.

Found 2026-10-27 while reviewing legacy Gemini and Antigravity direction for
core house cleaning.

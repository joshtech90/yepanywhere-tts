# Gemini ACP usage notifications exceed the pinned SDK schema

A live Gemini CLI session emits `session/update` with
`sessionUpdate: "usage_update"`, `used` and `size`. The pinned ACP client SDK
rejects that notification with `Invalid params` and logs the full union
validation error. Assistant text and the final result still arrive correctly.

Observed with the installed Gemini CLI, using an explicitly configured Gemini
API gateway and the production GeminiACPProvider. This is separate from the
idle message iterator abort bug fixed alongside the gateway setup.

A bounded follow-up should align the ACP schema/SDK or intentionally accept and
ignore that telemetry update. The model-access fix does not refresh the shared
ACP protocol and its other retained consumers.

Found 2026-11-02 while validating Gemini gateway access and idle chat shutdown.

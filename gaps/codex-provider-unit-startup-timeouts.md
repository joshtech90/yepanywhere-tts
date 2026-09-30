# Codex fake-process tests sometimes miss startup or first-turn requests

During the 2026-09-30 CI isolation campaign, a full workspace run failed 16
cases in `packages/server/test/sdk/providers/codex.test.ts`: some exhausted
the five-second test budget, others missed a fake request within two seconds.
A focused whole-file run failed seven different cases; a subsequent unchanged
whole-file run passed 122 cases with two skips in 19.86s. The unchanged full
workspace repeat passed all 6,148 server and 6,506 client cases. The dependency
resolutions were identical across these failing and passing runs; neither
dependency causality nor CPU contention is established.

The request waiter alone cannot distinguish child startup, initialization,
protocol failure or a blocked shell probe. `consumeCodexTurn` consumes error
messages without failing, and finalizers remove the request log. The fake
shell-probe server records `turn/start` after Bash and `ya-agent self` return;
that probe permits ten seconds while the request waiter permits two. Several
finalizers also omit awaiting `session.abort()`. Joined disposal is an
independent follow-up, not a proved cause of the earlier failures.

Capture a bounded failure-only timeline before cleanup: child bootstrap and
executable/version, parent spawn/error/exit, received/emitted RPC IDs and
methods, iterator errors/completion, polling gaps and capped stderr. Record
request receipt before shell probes, with probe completion separately. Do not
record prompts or environment values. A `LOG_LEVEL=debug` override is scrubbed
by the hermetic test environment and did not produce provider diagnostics.
Keep the existing deadlines until evidence identifies the failing stage.

2026-09-30 follow-up: fixture finalizers now await every session abort before
removing its files. Every generated fake child records a bounded, payload-free
bootstrap/received/emitted/exit timeline; shell probes record start/completion
separately from receipt. A missed request reports the last 24 phases and maximum
polling gap before cleanup. Turn consumption fails on unexpected terminal
errors, while explicit overload retry/interruption cases retain their expected
errors. The unchanged deadlines passed all 122 focused cases (two skips).
The underlying historical startup timeout remains unclassified; use the new
failure evidence rather than attributing it to contention or increasing waits.

Found 2026-09-30 during final dependency-audit verification. Both preceding
published CI unit runs passed; local repetition does not close this finding.

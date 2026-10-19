# Unit failure-path tests emit unasserted production warnings

The complete passing unit suite emits WARN output from intentionally rejected
project-queue dispatch, clearloop failure/reconciliation, transcript fork,
unavailable CUDA voice registration, gateway readiness timeout and invalid Pi
model-registry tests. These messages make a successful run noisy and prevent a
literal zero-warning claim. Installed MC launch tests and lint are clean.

Owners are the server queue scheduler/clearloop, session-fork, voice-registry,
Claude-gateway and Pi model-export tests. Capture the relevant logger calls in
those negative tests and assert their intended diagnostics, preserving
production warning behavior. Do not silence warnings globally. Multiple
unrelated test owners are outside the installed-client discovery change, so
this remains adjacent test hygiene rather than a reason to change their
runtime behavior.

2026-10-08: the Android native-lease teardown repair's full workspace run
passes 6,447 server and 6,804 client tests, retaining the diagnostics above
and `HIGHLIGHT: worker failed` for injected highlight-worker startup failure
and stall cases. The four Android JVM variants and Android lint are
warning-free. Capturing the unrelated server diagnostics spans queue,
clearloop, fork, voice, gateway, registry and highlight fixtures; it cannot
be folded safely into native lease ownership. No global filter was added.

Found 2026-10-02 while validating the installed Machine Control consumer with
the full unit suite (server 6,307 and client 6,634 passing tests).

2026-10-17: native response-window validation passes 6,595 server and 7,022
client cases. It still observes expected `[WS Relay] File response capped`
(`bytes=67108865`) and `Replay/old encrypted sequence rejected` (`seq=0,
last=1`) from separate download/security refusal fixtures. The touched streamed
response tests now capture and assert their own injected stall warnings. The
remaining cross-owner negative-path diagnostic debt above is not hidden with a
global logger or process-warning filter; production diagnostics are unchanged.

2026-10-18: Android host state/notification validation passes the full workspace
suite (6,613 server and 7,036 client cases), including the count-stream lifecycle
checks. The same unrelated negative-path queue, clearloop, highlight, transcript
fork and Pi registry fixtures still emit their expected production warnings.
Their cross-owner logger assertions cannot be safely folded into the native
host lifecycle change. Focused count-stream tests and Android lint are clean;
no global diagnostic filter was added.

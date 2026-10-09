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

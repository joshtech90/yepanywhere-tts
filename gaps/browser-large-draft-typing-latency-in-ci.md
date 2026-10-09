# Large-draft browser typing intermittently exceeds 100 ms in CI

General CI `37712171641` on `a079aa3f9`, browser shard 1
(`113100340505`), failed the first attempt of
`e2e/draft-sync.spec.ts:54`: two-device handoff and sequential typing with
3,000 cleared drafts, offline reload and send clear. The assertion at line 122
observed a maximum of 150.2 ms across 16 input acknowledgements against the
unchanged `< 100` ms ceiling. The automatic retry passed; the shard reported
194 passed, 7 skipped and 1 flaky.

The visible failure/summary is retained as
`tasks/android-hardening-round2/ci-a079-browser-one.txt`. This is a different
boundary from the stock-emulator-Chrome initial-typing miss: it exercises a
large synchronized draft catalog in hosted desktop Chromium. No loss of a
keystroke or common cause with that emulator observation is established.
The Android lifecycle fixture has one session and 50 messages, so it does not
supply a matched 3,000-draft Android result.

Keep the failed attempt and input deadline. Reproduce with the existing
large-draft fixture and capture input/frame attribution before changing
shared draft or rendering work. Host load is a hypothesis, not a diagnosis.
The current Android hardening round leaves web recovery policy unchanged;
this browser performance investigation remains separate follow-up work.

Found 2026-10-08 during Android internal-release verification.

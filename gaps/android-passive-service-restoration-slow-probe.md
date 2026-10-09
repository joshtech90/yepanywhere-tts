# Android can take almost a minute to notice silent service restoration

The October 7/8 final attachment-wake experiments recover automatically and
retain the route, text and staged file, but take about 57 seconds after the
fixture starts accepting connections again. The matched stock emulator Chrome
case recovers in about two seconds. The ordinary five-case native acceptance
matrix also records roughly 49–57 seconds for passive outage recovery.

This is a known consequence of the approved native quick-attempt budget and
visible 60-second backstop, not the old permanent-failure defect. The fault gate
restores the server path without changing Android's default network. Therefore
it supplies no new platform network-available signal; the separate real
Wi-Fi/data restoration test exercises that signal and passes. Typing, waking
or changing networks would measure a different recovery trigger.

Keep this as a UX follow-up rather than claiming that eventual recovery is
instant recovery. Before shortening the interval, measure attempts and recovery
latency on direct and relay routes. The relay's circuit-open budget and native
quick retries constrain a safe passive probe rate. Preserve one recovery owner,
signal coalescing, terminal authentication handling and no automatic write
replay. A unit timing regression must protect any agreed policy change; do not
alter the standard web client's policy merely to make the timings match.

Reproduce with the [lifecycle runner](../packages/client/e2e/lifecycle-study/README.md)
using Android session `wake-outage`, `--attachment=true`, no activity injection,
and `--verify=true`. See the
[second-round report](../docs/testing/android-lifecycle-hardening-2026-10-07.md)
for the final build and comparison evidence.

Observed again 2026-10-08; the existing 60-second policy was retained deliberately.

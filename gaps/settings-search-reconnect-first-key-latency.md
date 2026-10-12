# Settings search exceeded the first-key acknowledgement budget during reconnect

CI run 38212292431 on 2026-10-12 measured 157.3, 215.0 and 191.1 ms
for the first settings-search character across three attempts, plus one
115.1 ms later character. Every character remained present. The observer
measured keydown through the next animation frame, with a two-host relay
reconnect and a synthetic visibilitychange on every keydown.

The evidence does not isolate cold search-pane rendering from repeated wake
revalidation or runner scheduling. Settings search mounts real category panes
when the query first becomes nonempty; the retry trace starts about 80 pane
CSS/JS requests during typing. `SettingsLayout.tsx` also uses the raw query
while its deferred query is empty. Inspect `SettingsSearchResults.tsx` and
`SettingsLayout.tsx`, and compare a single genuine wake with a no-fault control
before changing rendering. Keep the 100 ms per-key bound and all-key checks.

The credential-ownership regression now types an actual per-host session draft
through the same freeze/reconnect/restoration boundary and checks draft
isolation. Settings filtering is outside that fix; this finding remains for
matched settings-search diagnosis. The CI logs and traces are retained in
[evidence](https://github.com/kzahel/yepanywhere/actions/runs/38212292431).

Found 2026-10-12 while verifying morning logout credential ownership.
